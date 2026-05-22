/**
 * Superpowers Bootstrap — Pi Extension Compatibility Layer
 *
 * Bridges superpowers skills into Pi:
 * 1. Injects using-superpowers bootstrap + Pi tool mapping into every session
 * 2. Detects pi-subagents availability and warns if missing
 * 3. Reads VERSION file for version tracking
 *
 * Mirrors what OpenCode's messages.transform and Claude Code's SessionStart
 * hook do, but using Pi's extension API.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const superpowersDir = path.join(packageRoot, "superpowers");
const skillsDir = path.join(superpowersDir, "skills");

// ── Read version ──────────────────────────────────────────────────────────

function readVersion(): string {
  try {
    return fs.readFileSync(path.join(superpowersDir, "VERSION"), "utf8").trim();
  } catch {
    return "unknown";
  }
}

// ── Strip YAML frontmatter ────────────────────────────────────────────────

function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n/);
  return match ? content.slice(match[0].length) : content;
}

// ── Read file, return empty on failure ────────────────────────────────────

function readIfExists(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

export default function (pi: ExtensionAPI) {
  const version = readVersion();

  // Read bootstrap content
  const usingSuperpowersContent = stripFrontmatter(
    readIfExists(path.join(skillsDir, "using-superpowers", "SKILL.md")),
  );

  // Pi tool mapping (upstream removed pi-tools.md, we maintain it here)
  const piToolMapping = `
| Skill references | Pi equivalent |
|-----------------|---------------|
| \`Skill\` tool (invoke a skill) | \`read\` to load \`skills/<skill-name>/SKILL.md\`, or \`/skill:name\` |
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
| \`EnterPlanMode\` / \`ExitPlanMode\` | No built-in equivalent |

### Additional Pi Tools
| Tool | Purpose |
|------|---------|
| \`code_search\` | Search for code examples and API docs |
| \`get_search_content\` | Retrieve content from prior searches |
| \`analyze_image\` | Targeted image analysis |

### Subagent Support
Pi supports subagents via the \`subagent\` tool (requires \`pi-subagents\`).
Install: \`pi install npm:pi-subagents\`.

When a skill says "dispatch a subagent" → use \`subagent\`.
When a skill says "dispatch in parallel" → use parallel mode of \`subagent\`.
`;

  // ── Detect pi-subagents ─────────────────────────────────────────────────

  let hasSubagents = false;

  function checkSubagents(): boolean {
    try {
      const tools = pi.getAllTools();
      hasSubagents = tools.some((t) => t.name === "subagent");
    } catch {
      // getAllTools may not be ready yet; retry on session_start
    }
    return hasSubagents;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  function hasBootstrapInSession(ctx: { sessionManager?: { getEntries?: () => Array<{ customType?: string }> } }): boolean {
    try {
      const entries = ctx.sessionManager?.getEntries?.();
      if (!entries) return false;
      return entries.some((e) => e.customType === "superpowers-bootstrap");
    } catch {
      return false;
    }
  }

  function buildBootstrapMessage(): string {
    const subagentNote = hasSubagents
      ? "pi-subagents is available. Use the `subagent` tool when skills ask to dispatch tasks."
      : "⚠️ pi-subagents is NOT installed. Skills that dispatch subagents (dispatching-parallel-agents, subagent-driven-development, executing-plans) will not work.\nTell the user to run: pi install npm:pi-subagents";

    return `<EXTREMELY_IMPORTANT>
You have superpowers (${version}).

${usingSuperpowersContent}

## Tool Mapping for Pi

Skills are written for Claude Code tool names. Always translate to Pi equivalents:

${piToolMapping}

## Status

${subagentNote}
</EXTREMELY_IMPORTANT>`;
  }

  // ── Session lifecycle ───────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    checkSubagents();

    ctx.ui.notify(
      `Superpowers ${version} · 14 skills loaded`,
      "info",
    );

    if (!hasSubagents) {
      ctx.ui.notify(
        "pi-subagents not installed. Some skills require it: pi install npm:pi-subagents",
        "warning",
      );
    }
  });

  // ── Inject bootstrap (once per session, survives reload/resume) ─────────

  pi.on("before_agent_start", async (_event, ctx) => {
    // Check if bootstrap already exists in session history
    // This prevents duplicates on reload, resume, fork, and tree navigation
    if (hasBootstrapInSession(ctx)) return;

    return {
      message: {
        customType: "superpowers-bootstrap",
        content: buildBootstrapMessage(),
        display: false,
      },
    };
  });

  // ── Context: deduplicate bootstrap across session tree nav ──────────────

  pi.on("context", async (event) => {
    let seen = false;
    return {
      messages: event.messages.filter((m) => {
        const msg = m as { customType?: string };
        if (msg.customType === "superpowers-bootstrap") {
          if (seen) return false; // Drop duplicates
          seen = true;
        }
        return true;
      }),
    };
  });
}
