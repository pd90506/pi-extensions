/**
 * Sync Agents — ships this package's custom agent definitions to pi.
 *
 * Pi packages cannot auto-load `agents/` directories, so this extension
 * copies `agents/*.md` from the package root into `~/.pi/agent/agents/`
 * on session start, where the subagent tool discovers them.
 *
 * Rules:
 * - Never overwrites an existing user agent (user customization wins)
 * - Only copies files that don't exist yet
 * - Notifies once per session if anything was synced
 */

import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

// Resolve package root (extensions/..). Uses jiti-provided __dirname
// (CJS compat), with import.meta.url fallback for ESM environments.
let extDir: string;
try {
  extDir = typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(new URL(import.meta.url).pathname);
} catch {
  extDir = path.resolve(".");
}
const packageAgentsDir = path.resolve(extDir, "..", "agents");

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(packageAgentsDir, { withFileTypes: true });
    } catch {
      return; // No agents/ directory in package — nothing to do
    }

    const userAgentsDir = path.join(getAgentDir(), "agents");
    const synced: string[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

      const target = path.join(userAgentsDir, entry.name);
      if (fs.existsSync(target)) continue; // user agent wins

      try {
        fs.mkdirSync(userAgentsDir, { recursive: true });
        fs.copyFileSync(path.join(packageAgentsDir, entry.name), target);
        synced.push(entry.name);
      } catch {
        // Best effort — skip files we can't copy
      }
    }

    if (synced.length > 0) {
      ctx.ui.notify(
        `Synced ${synced.length} agent(s) to ${userAgentsDir}: ${synced.join(", ")}`,
        "info",
      );
    }
  });
}
