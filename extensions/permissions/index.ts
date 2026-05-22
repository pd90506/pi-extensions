// extensions/permissions/index.ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { resolve } from "node:path";
import {
  classifyBashCommand,
  type ClassifierConfig,
} from "./classifier";

type PermissionLevel = 1 | 2 | 3 | 4 | 5;

const LEVEL_NAMES: Record<PermissionLevel, string> = {
  1: "Ask Permissions",
  2: "Accept Edits",
  3: "Plan Mode",
  4: "Auto Mode",
  5: "Bypass Permissions",
};

const LEVEL_STATUS: Record<PermissionLevel, string> = {
  1: "🔒 Ask",
  2: "✏️ AcceptEdits",
  3: "📋 Plan",
  4: "🤖 Auto",
  5: "⚡ Bypass",
};

const DEFAULT_LEVEL: PermissionLevel = 1;

const READ_TOOLS = new Set(["read", "web_search", "fetch_content", "code_search"]);

function isPathInsideCwd(cwd: string, toolPath: string): boolean {
  const resolved = resolve(cwd, toolPath.startsWith("@") ? toolPath.slice(1) : toolPath);
  const normalized = resolved.endsWith("/") ? resolved : resolved + "/";
  const normalizedCwd = cwd.endsWith("/") ? cwd : cwd + "/";
  return normalized.startsWith(normalizedCwd);
}

export default function (pi: ExtensionAPI) {
  let currentLevel: PermissionLevel = DEFAULT_LEVEL;

  // ── State persistence ──
  pi.on("session_start", async (_event, ctx) => {
    for (const entry of ctx.sessionManager.getEntries()) {
      if (
        entry.type === "custom" &&
        entry.customType === "permissions-level"
      ) {
        const data = entry.data as { level: number } | undefined;
        if (
          data &&
          typeof data.level === "number" &&
          data.level >= 1 &&
          data.level <= 5
        ) {
          currentLevel = data.level as PermissionLevel;
        }
      }
    }
    updateStatus(ctx);
  });

  function setLevel(level: PermissionLevel, ctx: ExtensionContext) {
    currentLevel = level;
    pi.appendEntry("permissions-level", { level });
    updateStatus(ctx);
  }

  function updateStatus(ctx: { ui: { setStatus: (k: string, v: string | undefined) => void }; hasUI: boolean }) {
    if (!ctx.hasUI) return;
    const label = LEVEL_STATUS[currentLevel];
    if (currentLevel === 5) {
      ctx.ui.setStatus("permissions", `⚠️ ${label}`);
    } else {
      ctx.ui.setStatus("permissions", label);
    }
  }

  // ── Tool call interception ──
  pi.on("tool_call", async (event, ctx) => {
    const toolName = event.toolName;

    // Build the decision based on current level
    const decision = getDecision(toolName, event.input, ctx.cwd);

    if (decision.action === "allow") return undefined;

    if (decision.action === "block") {
      return { block: true, reason: decision.reason };
    }

    // decision.action === "prompt"
    if (!ctx.hasUI) {
      return { block: true, reason: `Blocked in non-interactive mode: ${decision.reason}` };
    }

    const approved = await promptUser(toolName, event.input, decision.reason, ctx);
    if (!approved) {
      return { block: true, reason: "Blocked by user" };
    }

    return undefined;
  });

  type Decision =
    | { action: "allow" }
    | { action: "block"; reason: string }
    | { action: "prompt"; reason: string };

  function getDecision(
    toolName: string,
    input: Record<string, unknown>,
    cwd: string,
  ): Decision {
    // Shared baseline: read tools always allowed
    if (READ_TOOLS.has(toolName)) return { action: "allow" };

    switch (currentLevel) {
      case 1: return getLevel1Decision(toolName);
      case 2: return getLevel2Decision(toolName, input, cwd);
      case 3: return getLevel3Decision(toolName);
      case 4: return getLevel4Decision(toolName);
      case 5: return { action: "allow" };
      default: return { action: "prompt", reason: "Unknown permission level" };
    }
  }

  function getLevel1Decision(toolName: string): Decision {
    if (toolName === "edit" || toolName === "write") {
      return { action: "prompt", reason: "Write operation needs approval (Ask Permissions)" };
    }
    if (toolName === "bash") {
      return { action: "prompt", reason: "Bash command needs approval (Ask Permissions)" };
    }
    return { action: "prompt", reason: `"${toolName}" needs approval (Ask Permissions)` };
  }

  function getLevel2Decision(
    toolName: string,
    input: Record<string, unknown>,
    cwd: string,
  ): Decision {
    if (toolName === "edit" || toolName === "write") {
      const path = input.path as string | undefined;
      if (path && isPathInsideCwd(cwd, path)) {
        return { action: "allow" };
      }
      return {
        action: "prompt",
        reason: `Write outside project directory: ${path ?? "unknown"}`,
      };
    }
    if (toolName === "bash") {
      return { action: "prompt", reason: "Bash command needs approval (Accept Edits)" };
    }
    return { action: "prompt", reason: `"${toolName}" needs approval (Accept Edits)` };
  }

  function getLevel3Decision(toolName: string): Decision {
    if (toolName === "edit" || toolName === "write") {
      return { action: "block", reason: "Plan mode — switch to Accept Edits or higher to make changes" };
    }
    if (toolName === "bash") {
      return { action: "block", reason: "Plan mode — switch to Accept Edits or higher to run commands" };
    }
    return { action: "prompt", reason: `"${toolName}" needs approval (Plan Mode)` };
  }

  function getLevel4Decision(toolName: string): Decision {
    if (toolName === "bash") {
      return { action: "prompt", reason: "classify" };
    }
    return { action: "allow" };
  }

  async function promptUser(
    toolName: string,
    input: Record<string, unknown>,
    reason: string,
    ctx: ExtensionContext,
  ): Promise<boolean> {
    // Level 4 bash classification
    if (toolName === "bash" && reason === "classify") {
      return classifyThenPrompt(input, ctx);
    }

    const commandDetail = toolName === "bash"
      ? `\n\n  ${input.command as string}`
      : toolName === "edit" || toolName === "write"
        ? `\n\n  Path: ${input.path as string}`
        : "";

    const choice = await ctx.ui.select(
      `⚠️ ${toolName} — ${reason}${commandDetail}\n\nAllow?`,
      ["Yes", "No"],
    );
    return choice === "Yes";
  }

  async function classifyThenPrompt(
    input: Record<string, unknown>,
    ctx: ExtensionContext,
  ): Promise<boolean> {
    const command = input.command as string;

    try {
      const config = getClassifierConfig(ctx);
      if (!config) {
        const choice = await ctx.ui.select(
          `⚠️ bash (Auto Mode — classifier unavailable)\n\n  ${command}\n\nAllow?`,
          ["Yes", "No"],
        );
        return choice === "Yes";
      }

      const result = await classifyBashCommand(command, ctx.cwd, config, ctx.signal);

      if (result.risk === "low") {
        return true;
      }

      const riskLabel = result.risk === "high" ? "🔴 HIGH" : "🟡 MEDIUM";
      const choice = await ctx.ui.select(
        `⚠️ bash (Auto Mode — ${riskLabel} risk)\n\n  ${command}\n\n  Reason: ${result.reason}\n\nAllow?`,
        ["Yes", "No"],
      );
      return choice === "Yes";
    } catch {
      const choice = await ctx.ui.select(
        `⚠️ bash (Auto Mode — classification failed)\n\n  ${command}\n\nAllow?`,
        ["Yes", "No"],
      );
      return choice === "Yes";
    }
  }

  function getClassifierConfig(_ctx: ExtensionContext): ClassifierConfig | null {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      return {
        baseUrl: "https://api.anthropic.com",
        apiKey: anthropicKey,
        model: "claude-haiku-3-5-20241022",
        api: "anthropic-messages",
      };
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      return {
        baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com",
        apiKey: openaiKey,
        model: "gpt-4o-mini",
        api: "openai-completions",
      };
    }

    return null;
  }
}
