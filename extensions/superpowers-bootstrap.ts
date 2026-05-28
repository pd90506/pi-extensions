/**
 * Superpowers Bootstrap — Pi Extension Compatibility Layer
 *
 * Bridges superpowers skills into Pi:
 * 1. Injects using-superpowers bootstrap + Pi tool mapping on first turn
 * 2. Detects pi-subagents availability and warns if missing
 * 3. Deduplicates injection across reload, resume, fork, tree navigation
 * 4. /superpowers-subagent-model command to configure model + thinking for
 *    all superpowers subagents (persisted globally)
 * 5. tool_call interception to inject configured model into subagent calls
 */

import { DynamicBorder, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text } from "@earendil-works/pi-tui";
import fs from "node:fs";
import path from "node:path";

// ── Resolve paths ────────────────────────────────────────────────────────

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

const CONFIG_PATH = path.join(getAgentDir(), "superpowers-model-config.json");

// ── Types ────────────────────────────────────────────────────────────────

interface SubagentModelConfig {
  /** provider/model string, e.g. "deepseek/deepseek-v4-flash" */
  model?: string;
  /** Thinking level for subagents */
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
}

const DEFAULT_CONFIG: SubagentModelConfig = {
  model: "deepseek/deepseek-v4-flash",
  thinking: "xhigh",
};

const SUPERPOWERS_AGENTS = new Set([
  "superpowers-implementer",
  "superpowers-spec-reviewer",
  "superpowers-code-reviewer",
]);

const THINKING_LEVELS: Array<{ value: SubagentModelConfig["thinking"]; label: string; description: string }> = [
  { value: "off", label: "off", description: "No thinking tokens" },
  { value: "minimal", label: "minimal", description: "Brief thinking" },
  { value: "low", label: "low", description: "Light thinking" },
  { value: "medium", label: "medium", description: "Moderate thinking" },
  { value: "high", label: "high", description: "Deep thinking" },
  { value: "xhigh", label: "xhigh (max)", description: "Maximum thinking" },
];

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

function loadConfig(): SubagentModelConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config: SubagentModelConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

// ── tool_call: inject model into subagent calls ──────────────────────────

/**
 * Walk a subagent call input and inject model/thinking into any
 * superpowers-agent invocations that don't already have an explicit model.
 */
function injectModelIntoSubagentInput(
  input: Record<string, unknown>,
  config: SubagentModelConfig,
): void {
  if (!config.model) return;

  // Single agent invocation: { agent: "superpowers-implementer", ... }
  const agent = input.agent as string | undefined;
  if (agent && SUPERPOWERS_AGENTS.has(agent)) {
    if (!input.model) input.model = config.model;
    if (!input.thinking && config.thinking) input.thinking = config.thinking;
  }

  // Parallel tasks: { tasks: [{ agent: ... }] }
  const tasks = input.tasks as Array<Record<string, unknown>> | undefined;
  if (tasks) {
    for (const task of tasks) {
      if (
        typeof task.agent === "string" &&
        SUPERPOWERS_AGENTS.has(task.agent)
      ) {
        if (!task.model) task.model = config.model;
        if (!task.thinking && config.thinking) task.thinking = config.thinking;
      }
    }
  }

  // Chain: { chain: [{ agent: ... }] } or { chain: [{ parallel: [{ agent: ... }] }] }
  const chain = input.chain as Array<Record<string, unknown>> | undefined;
  if (chain) {
    for (const step of chain) {
      // Direct chain step with agent
      if (
        typeof step.agent === "string" &&
        SUPERPOWERS_AGENTS.has(step.agent)
      ) {
        if (!step.model) step.model = config.model;
        if (!step.thinking && config.thinking) step.thinking = config.thinking;
      }
      // Chain step with parallel fan-out
      const parallel = step.parallel as Array<Record<string, unknown>> | undefined;
      if (parallel) {
        for (const p of parallel) {
          if (
            typeof p.agent === "string" &&
            SUPERPOWERS_AGENTS.has(p.agent)
          ) {
            if (!p.model) p.model = config.model;
            if (!p.thinking && config.thinking) p.thinking = config.thinking;
          }
        }
      }
    }
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

  let config: SubagentModelConfig = loadConfig();

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

    const modelNote = config.model
      ? `Superpowers subagents use model: ${config.model}${config.thinking ? ` (thinking: ${config.thinking})` : ""}. Use /superpowers-subagent-model to change.`
      : "No subagent model configured. Superpowers subagents will use the agent's default model (may fail if Anthropic is not configured). Use /superpowers-subagent-model to set one.";

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

${modelNote}
</EXTREMELY_IMPORTANT>`;
  }

  // ── Model selector UI ────────────────────────────────────────────────────

  async function showModelSelector(ctx: ExtensionContext): Promise<void> {
    // Get available models with auth
    const models = ctx.modelRegistry.getAvailable();

    // Group by provider for readability, deduplicate by provider/id
    const seen = new Set<string>();
    const items: Array<{ value: string; label: string; description: string }> = [];

    for (const m of models) {
      const key = `${m.provider}/${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const thinking = m.reasoning ? "thinking" : "no-thinking";
      const images = m.input.includes("image") ? "images" : "no-images";
      const ctxWin = m.contextWindow >= 1_000_000
        ? `${(m.contextWindow / 1_000_000).toFixed(1)}M`
        : `${Math.round(m.contextWindow / 1000)}K`;

      items.push({
        value: key,
        label: key,
        description: `${ctxWin} ctx · ${thinking} · ${images}`,
      });
    }

    // Sort: current model first, then alphabetical
    items.sort((a, b) => {
      if (a.value === config.model) return -1;
      if (b.value === config.model) return 1;
      return a.value.localeCompare(b.value);
    });

    // Add "reset to default" option
    items.push({
      value: "__default__",
      label: "Reset to default",
      description: `deepseek/deepseek-v4-flash (xhigh)`,
    });

    const selected = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));

      container.addChild(new Text(theme.fg("accent", theme.bold("Select Subagent Model"))));
      container.addChild(new Text(theme.fg("muted", "Current: " + (config.model || "(none)"))));
      container.addChild(new Text(""));

      const list = new SelectList(items, Math.min(items.length, 12), {
        selectedPrefix: (text: string) => theme.fg("accent", text),
        selectedText: (text: string) => theme.fg("accent", text),
        description: (text: string) => theme.fg("muted", text),
        scrollInfo: (text: string) => theme.fg("dim", text),
        noMatch: (text: string) => theme.fg("warning", text),
      });

      list.onSelect = (item: { value: string }) => done(item.value);
      list.onCancel = () => done(null);

      container.addChild(list);
      container.addChild(new Text(theme.fg("dim", "↑↓ navigate · enter select · esc cancel")));
      container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));

      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          list.handleInput(data);
          tui.requestRender();
        },
      };
    });

    if (!selected) return;

    if (selected === "__default__") {
      config = { ...DEFAULT_CONFIG };
      saveConfig(config);
      ctx.ui.notify(`Reset to default: ${config.model} (thinking: ${config.thinking})`, "info");
      return;
    }

    // Show thinking level submenu
    const thinkingItems = THINKING_LEVELS.map((tl) => ({
      value: tl.value!,
      label: tl.value === config.thinking ? `${tl.label} (current)` : tl.label,
      description: tl.description,
    }));

    const chosenThinking = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
      const container = new Container();
      container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
      container.addChild(new Text(theme.fg("accent", theme.bold("Select Thinking Level"))));
      container.addChild(new Text(theme.fg("muted", `For: ${selected}`)));
      container.addChild(new Text(""));

      const list = new SelectList(thinkingItems, thinkingItems.length, {
        selectedPrefix: (text: string) => theme.fg("accent", text),
        selectedText: (text: string) => theme.fg("accent", text),
        description: (text: string) => theme.fg("muted", text),
        scrollInfo: (text: string) => theme.fg("dim", text),
        noMatch: (text: string) => theme.fg("warning", text),
      });

      list.onSelect = (item: { value: string }) => done(item.value);
      list.onCancel = () => done(null);

      container.addChild(list);
      container.addChild(new Text(theme.fg("dim", "↑↓ navigate · enter select · esc cancel")));
      container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));

      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          list.handleInput(data);
          tui.requestRender();
        },
      };
    });

    config = {
      model: selected,
      thinking: (chosenThinking as SubagentModelConfig["thinking"]) || config.thinking || "xhigh",
    };
    saveConfig(config);
    ctx.ui.notify(`Subagent model: ${config.model} (thinking: ${config.thinking})`, "info");
  }

  // ── Event handlers ──────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    checkSubagents();
    config = loadConfig();

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

  // Inject model into superpowers subagent calls
  pi.on("tool_call", async (event, _ctx) => {
    if (event.toolName !== "subagent") return;
    if (!config.model) return;

    injectModelIntoSubagentInput(
      event.input as Record<string, unknown>,
      config,
    );
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

  // ── Commands ─────────────────────────────────────────────────────────────

  pi.registerCommand("superpowers-subagent-model", {
    description: "Configure model and thinking level for superpowers subagents",
    handler: async (_args, ctx) => {
      await showModelSelector(ctx);
    },
  });
}