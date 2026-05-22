// extensions/permissions/index.ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { realpathSync } from "node:fs";
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
  const raw = toolPath.startsWith("@") ? toolPath.slice(1) : toolPath;
  const resolved = resolve(cwd, raw);
  // Resolve symlinks for existing files; fall back to resolved path for new files
  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
    real = resolved;
  }
  const normalized = real.endsWith("/") ? real : real + "/";
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

    // Restore warning widget if level 5
    if (currentLevel === 5) {
      ctx.ui.setWidget("permissions-warning", [
        "⚠️ BYPASS MODE — All tool calls auto-approved without confirmation",
      ]);
    } else {
      ctx.ui.setWidget("permissions-warning", undefined);
    }
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

  // ── /permissions command ──
  pi.registerCommand("permissions", {
    description: "Show or set the permission level (1-5)",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;

      const levelNum = parseInt(args?.trim() ?? "", 10);
      if (levelNum >= 1 && levelNum <= 5) {
        await activateLevel(levelNum as PermissionLevel, ctx);
        return;
      }

      // Show current level
      const levelName = LEVEL_NAMES[currentLevel];
      const desc = getLevelDescription(currentLevel);
      ctx.ui.notify(
        `Permissions: Level ${currentLevel} — ${levelName}\n${desc}`,
        "info",
      );
    },
  });

  function getLevelDescription(level: PermissionLevel): string {
    switch (level) {
      case 1: return "Prompts before every write, bash, and unknown tool call.";
      case 2: return "Auto-approves file edits within the project; prompts for bash and external paths.";
      case 3: return "Read-only. Blocks all writes and bash commands.";
      case 4: return "Auto-approves most tools. Bash commands are classified by risk.";
      case 5: return "All tools auto-approved without prompts. ⚠️ USE WITH CAUTION.";
    }
  }

  async function activateLevel(level: PermissionLevel, ctx: ExtensionContext) {
    if (level === 5) {
      // Double-confirm for bypass
      const first = await ctx.ui.confirm(
        "Bypass ALL permissions?",
        "This allows ANY tool call without confirmation. Are you sure?",
      );
      if (!first) {
        ctx.ui.notify("Bypass cancelled", "info");
        return;
      }
      const second = await ctx.ui.confirm(
        "⚠️ FINAL WARNING",
        "Bypass ALL permissions. This allows ANY tool call without confirmation. Proceed?",
      );
      if (!second) {
        ctx.ui.notify("Bypass cancelled", "info");
        return;
      }
    }

    setLevel(level, ctx);
    ctx.ui.notify(
      `Permissions set to Level ${level} — ${LEVEL_NAMES[level]}`,
      level === 5 ? "warning" : "info",
    );

    // Warning widget for level 5
    if (level === 5) {
      ctx.ui.setWidget("permissions-warning", [
        "⚠️ BYPASS MODE — All tool calls auto-approved without confirmation",
      ]);
    } else {
      ctx.ui.setWidget("permissions-warning", undefined);
    }
  }

  // ── set_permissions tool — LLM can request level change ──
  pi.registerTool({
    name: "set_permissions",
    label: "Set Permissions",
    description:
      "Request to change the permission level. Levels: 1=Ask Permissions (prompt for writes/bash), 2=Accept Edits (auto-allow file edits within project), 3=Plan Mode (read-only), 4=Auto Mode (classify bash by risk), 5=Bypass (no prompts, requires user double-confirm). Use this when you need elevated permissions to complete a task.",
    promptSnippet: "Request permission level change (1-5)",
    promptGuidelines: [
      "Use set_permissions to request elevated permissions when blocked by the current level. Call set_permissions with the target level number and a brief reason.",
    ],
    parameters: Type.Object({
      level: Type.Number({ description: "Target permission level (1-5)" }),
      reason: Type.Optional(
        Type.String({ description: "Why this level is needed" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const level = params.level;
      if (level < 1 || level > 5 || !Number.isInteger(level)) {
        return {
          content: [
            {
              type: "text",
              text: `Invalid level: ${level}. Must be an integer 1-5.`,
            },
          ],
          details: {},
        };
      }

      if (level === currentLevel) {
        return {
          content: [
            {
              type: "text",
              text: `Already at Level ${level} — ${LEVEL_NAMES[level as PermissionLevel]}.`,
            },
          ],
          details: {},
        };
      }

      if (!ctx.hasUI) {
        return {
          content: [
            {
              type: "text",
              text: `Cannot change permissions in non-interactive mode.`,
            },
          ],
          details: {},
        };
      }

      const targetName = LEVEL_NAMES[level as PermissionLevel];
      const reasonText = params.reason ? `\n\nReason: ${params.reason}` : "";
      const approved = await ctx.ui.confirm(
        `Change permissions to Level ${level}?`,
        `Switch to "${targetName}".${reasonText}`,
      );

      if (approved) {
        await activateLevel(level as PermissionLevel, ctx);
        return {
          content: [
            {
              type: "text",
              text: `Permission level set to ${level} — ${targetName}.`,
            },
          ],
          details: { level },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Permission level change to ${level} was declined by user.`,
          },
        ],
        details: {},
      };
    },
  });

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

    const approved = await promptUser(toolName, event.input, decision, ctx);
    if (!approved) {
      return { block: true, reason: "Blocked by user" };
    }

    return undefined;
  });

  type Decision =
    | { action: "allow" }
    | { action: "block"; reason: string }
    | { action: "prompt"; reason: string; needsClassification?: boolean };

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
      return { action: "prompt", reason: "Bash command needs classification (Auto Mode)", needsClassification: true };
    }
    return { action: "allow" };
  }

  async function promptUser(
    toolName: string,
    input: Record<string, unknown>,
    decision: Decision & { action: "prompt" },
    ctx: ExtensionContext,
  ): Promise<boolean> {
    // Level 4 bash classification
    if (toolName === "bash" && decision.needsClassification) {
      return classifyThenPrompt(input, ctx);
    }

    const commandDetail = toolName === "bash"
      ? `\n\n  ${input.command as string}`
      : toolName === "edit" || toolName === "write"
        ? `\n\n  Path: ${input.path as string}`
        : "";

    const choice = await ctx.ui.select(
      `⚠️ ${toolName} — ${decision.reason}${commandDetail}\n\nAllow?`,
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
