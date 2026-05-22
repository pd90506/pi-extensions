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
}
