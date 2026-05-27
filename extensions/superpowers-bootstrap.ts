/**
 * Superpowers Bootstrap — Pi Extension Compatibility Layer
 *
 * Bridges superpowers skills into Pi:
 * 1. Injects using-superpowers bootstrap + Pi tool mapping on first turn
 * 2. Detects pi-subagents availability and warns if missing
 * 3. Deduplicates injection across reload, resume, fork, tree navigation
 *
 * Mirrors what OpenCode's messages.transform and Claude Code's SessionStart
 * hook do, but using Pi's extension API.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";

// Resolve package root. Uses jiti-provided __dirname (CJS compat),
// with import.meta.url fallback for ESM environments.
let extDir: string;
try {
  extDir = typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(new URL(import.meta.url).pathname);
} catch {
  extDir = path.resolve(".");
}
const packageRoot = path.resolve(extDir, "..");
const superpowersDir = path.join(packageRoot, "superpowers");
const skillsDir = path.join(superpowersDir, "skills");

// ── File utilities ────────────────────────────────────────────────────────

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n/);
  return match ? content.slice(match[0].length) : content;
}

function readIfExists(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

// ── Tool mapping ──────────────────────────────────────────────────────────

const PI_TOOL_MAPPING = `
| Skill references | Pi equivalent |
|-----------------|---------------|
| \`Skill\` tool (invoke a skill) | Use \`read\` on the exact \`<location>\` path shown for that skill in \`<available_skills>\`. In interactive Pi, the user can also force-load with \`/skill:name\`. |
| \`Task\` tool (dispatch subagent) | \`subagent\` (requires \`pi-subagents\` package) |
| \`Read\` (file reading) | \`read\` |
| \`Write\` (file creation) | \`write\` |
| \`Edit\` (file editing) | \`edit\` |
| \`Bash\` (run commands) | \`bash\` |
| \`Grep\` (search file content) | \`bash\` with \`grep\` or \`rg\` |
| \`Glob\` (search files by name) | \`bash\` with \`ls\`, \`find\` |
| \`WebSearch\` | \`web_search\` |
| \`WebFetch\` | \`fetch_content\` |
| \`TodoWrite\` (task tracking) | Use \`write\` to create a task file, or maintain a mental checklist |
| \`EnterPlanMode\` / \`ExitPlanMode\` | No built-in Pi equivalent |

### Additional Pi-Only Tools
| Tool | Purpose |
|------|---------|
| \`code_search\` | Search for code examples and API docs |
| \`get_search_content\` | Retrieve content from prior searches |
| \`analyze_image\` | Targeted image analysis |

### Subagent Support
Install: \`pi install npm:pi-subagents\`.
When a skill says "dispatch a subagent" → use \`subagent\`.
When a skill says "dispatch in parallel" → use parallel mode of \`subagent\`.
`;

// ── Extension ─────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const usingSuperpowersContent = stripFrontmatter(
    readIfExists(path.join(skillsDir, "using-superpowers", "SKILL.md")),
  );

  // ── Detect pi-subagents ─────────────────────────────────────────────────

  let hasSubagents = false;

  function checkSubagents(): boolean {
    try {
      hasSubagents = pi.getAllTools().some((t) => t.name === "subagent");
    } catch {
      // May not be ready during module load; retried on session_start
    }
    return hasSubagents;
  }

  // ── Bootstrap injection guard ───────────────────────────────────────────

  type SessionCtx = {
    sessionManager?: {
      buildSessionContext?: () => { messages?: Array<{ customType?: string }> };
      getEntries?: () => Array<{
        type?: string;
        customType?: string;
        message?: { customType?: string };
      }>;
    };
  };

  function hasBootstrapInCurrentContext(ctx: SessionCtx): boolean {
    try {
      const messages = ctx.sessionManager?.buildSessionContext?.().messages;
      if (messages) {
        return messages.some((m) => m.customType === "superpowers-bootstrap");
      }
    } catch {
      // Fall through to the compatibility fallback below.
    }

    // Compatibility fallback for older Pi versions without buildSessionContext().
    // Prefer current-context checks above because getEntries() includes other
    // branches and compacted-away history.
    try {
      const entries = ctx.sessionManager?.getEntries?.();
      return entries?.some((e) =>
        e.type === "custom_message" &&
        (e.customType === "superpowers-bootstrap" ||
          e.message?.customType === "superpowers-bootstrap")
      ) ?? false;
    } catch {
      return false;
    }
  }

  function buildBootstrapMessage(): string {
    const subagentNote = hasSubagents
      ? "pi-subagents is available. Use the `subagent` tool when skills ask to dispatch tasks."
      : "⚠️ pi-subagents is NOT installed. Skills that require subagents (dispatching-parallel-agents, subagent-driven-development, executing-plans) will not work.\nTell the user to run: pi install npm:pi-subagents";

    return `<EXTREMELY_IMPORTANT>
You have superpowers.

## Pi Adaptation

The using-superpowers content below is already loaded. Do not load using-superpowers again. When it mentions Claude Code's \`Skill\` tool, use Pi's \`read\` tool on the matching skill \`<location>\` from \`<available_skills>\` instead.

${usingSuperpowersContent}

## Tool Mapping for Pi

Skills are written for Claude Code tool names. Always translate to Pi equivalents:

${PI_TOOL_MAPPING}

## Status

${subagentNote}
</EXTREMELY_IMPORTANT>`;
  }

  // ── Event handlers ──────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    checkSubagents();

    ctx.ui.notify("Superpowers loaded", "info");

    if (!hasSubagents) {
      ctx.ui.notify(
        "pi-subagents not installed. Some skills require it: pi install npm:pi-subagents",
        "warning",
      );
    }
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (hasBootstrapInCurrentContext(ctx)) return;

    return {
      message: {
        customType: "superpowers-bootstrap",
        content: buildBootstrapMessage(),
        display: false,
      },
    };
  });

  pi.on("context", async (event) => {
    let seen = false;
    return {
      messages: event.messages.filter((m) => {
        const msg = m as { customType?: string };
        if (msg.customType === "superpowers-bootstrap") {
          if (seen) return false;
          seen = true;
        }
        return true;
      }),
    };
  });
}
