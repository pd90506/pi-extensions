# Permissions Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-level permission gate extension for Pi that intercepts tool calls and applies allow/block/prompt rules per the active permission level (1-5), matching Claude Code's permission model.

**Architecture:** Two-file extension under `extensions/permissions/`. `index.ts` registers all hooks, commands, shortcuts, and the custom tool. `classifier.ts` provides a standalone LLM-based bash command risk classifier for Level 4 Auto Mode. State persists via `appendEntry`.

**Spec:** `docs/superpowers/specs/2026-05-22-permissions-extension-design.md`

**Tech Stack:** TypeScript (jiti-loaded by Pi), `@earendil-works/pi-coding-agent` (ExtensionAPI, events, UI), `@earendil-works/pi-ai` (Type for schemas), Node.js built-ins (`node:path` for path resolution).

---

### Task 1: Create directory structure

**Files:**
- Create: `extensions/permissions/index.ts` (empty skeleton)
- Create: `extensions/permissions/classifier.ts` (empty skeleton)

- [ ] **Step 1: Create the permissions extension directory**

```bash
mkdir -p extensions/permissions
```

- [ ] **Step 2: Create classifier.ts skeleton**

```typescript
// extensions/permissions/classifier.ts
// Bash command risk classifier — uses lightweight LLM call for risk assessment

export type RiskLevel = "low" | "medium" | "high";

export interface ClassificationResult {
  risk: RiskLevel;
  reason: string;
}
```

- [ ] **Step 3: Create index.ts skeleton**

```typescript
// extensions/permissions/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Entry point — hooks registered in subsequent tasks
}
```

- [ ] **Step 4: Commit**

```bash
git add extensions/permissions/
git commit -m "feat: scaffold permissions extension directory"
```

### Task 2: Write the classifier module

**Files:**
- Modify: `extensions/permissions/classifier.ts`

- [ ] **Step 1: Write classifyBashCommand with classification prompt and API call**

```typescript
// extensions/permissions/classifier.ts

export type RiskLevel = "low" | "medium" | "high";

export interface ClassificationResult {
  risk: RiskLevel;
  reason: string;
}

export interface ClassifierConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  api: "anthropic-messages" | "openai-completions";
}

const CLASSIFICATION_PROMPT = `You are a bash command safety classifier. Analyze the following command and classify its risk level.

Risk levels:
- low: Safe/read-only operations (ls, cat, echo, grep, find, git status/diff/log, npm test, cargo build, standard build commands)
- medium: Potentially destructive but recoverable (git commit/push, npm install, pip install, file moves/renames, docker commands)
- high: Destructive or dangerous (rm -rf, sudo, curl | bash, chmod 777, git push --force, database drops, kill, shutdown)

Respond with ONLY a JSON object: {"risk": "low"|"medium"|"high", "reason": "brief explanation"}`;

export async function classifyBashCommand(
  command: string,
  cwd: string,
  config: ClassifierConfig,
  signal?: AbortSignal,
): Promise<ClassificationResult> {
  if (config.api === "anthropic-messages") {
    return classifyAnthropic(command, cwd, config, signal);
  }
  return classifyOpenAI(command, cwd, config, signal);
}

async function classifyAnthropic(
  command: string,
  cwd: string,
  config: ClassifierConfig,
  signal?: AbortSignal,
): Promise<ClassificationResult> {
  const response = await fetch(`${config.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 256,
      messages: [
        { role: "user", content: `${CLASSIFICATION_PROMPT}\n\nCommand: ${command}\nWorking directory: ${cwd}` },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Classification API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  const text = data.content.find((c) => c.type === "text")?.text ?? "";
  return parseClassification(text);
}

async function classifyOpenAI(
  command: string,
  cwd: string,
  config: ClassifierConfig,
  signal?: AbortSignal,
): Promise<ClassificationResult> {
  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 256,
      temperature: 0,
      messages: [
        { role: "user", content: `${CLASSIFICATION_PROMPT}\n\nCommand: ${command}\nWorking directory: ${cwd}` },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Classification API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const text = data.choices[0]?.message?.content ?? "";
  return parseClassification(text);
}

function parseClassification(text: string): ClassificationResult {
  // Try to extract JSON from the response
  const jsonMatch = text.match(/\{[^}]+\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const risk = parsed.risk as RiskLevel;
      if (risk === "low" || risk === "medium" || risk === "high") {
        return { risk, reason: parsed.reason ?? "No reason provided" };
      }
    } catch {
      // fall through to fallback
    }
  }
  // Fallback: treat as high risk if parsing fails
  return { risk: "high", reason: "Failed to parse classifier response" };
}
```

- [ ] **Step 2: Verify the file**

```bash
cat extensions/permissions/classifier.ts | wc -l
```

- [ ] **Step 3: Commit**

```bash
git add extensions/permissions/classifier.ts
git commit -m "feat: add bash command risk classifier module"
```

### Task 3: Write extension entry — types, constants, and state management

**Files:**
- Modify: `extensions/permissions/index.ts`

- [ ] **Step 1: Define permission level types, constants, and level state management**

```typescript
// extensions/permissions/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { isAbsolute, resolve } from "node:path";
import {
  classifyBashCommand,
  type ClassifierConfig,
  type ClassificationResult,
  type RiskLevel,
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

// Tools that the classifier itself may trigger — bypass permissions to avoid recursion
const CLASSIFIER_BYPASS_TOOLS = new Set(["classify_bash"]);

function isPathInsideCwd(cwd: string, toolPath: string): boolean {
  const resolved = resolve(cwd, toolPath.startsWith("@") ? toolPath.slice(1) : toolPath);
  // Normalize: ensure the resolved path starts with cwd
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

  // Placeholder: tool_call handler, command, shortcut, tool — added in subsequent tasks
}
```

- [ ] **Step 2: Commit**

```bash
git add extensions/permissions/index.ts
git commit -m "feat: add permission level types, constants, and state management"
```

### Task 4: Write the tool_call permission rules handler

**Files:**
- Modify: `extensions/permissions/index.ts`

- [ ] **Step 1: Add the tool_call event handler with all level rules**

Insert the following inside `export default function (pi: ExtensionAPI) { ... }`, after the `updateStatus` function:

```typescript
  // ── Tool call interception ──
  pi.on("tool_call", async (event, ctx) => {
    const toolName = event.toolName;

    // Bypass for classifier-internal tools (avoid infinite recursion)
    if (CLASSIFIER_BYPASS_TOOLS.has(toolName)) return undefined;

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
    // Level 1: prompt for writes, bash, and everything else
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
    // Level 2: auto-allow edits/writes within cwd, prompt for bash and external paths
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
    // Level 3: block writes and bash, prompt for unknown tools
    if (toolName === "edit" || toolName === "write") {
      return { action: "block", reason: "Plan mode — switch to Accept Edits or higher to make changes" };
    }
    if (toolName === "bash") {
      return { action: "block", reason: "Plan mode — switch to Accept Edits or higher to run commands" };
    }
    return { action: "prompt", reason: `"${toolName}" needs approval (Plan Mode)` };
  }

  function getLevel4Decision(toolName: string): Decision {
    // Level 4: auto-allow most tools; bash needs classification
    if (toolName === "bash") {
      // Classification happens in the prompt handler (async)
      return { action: "prompt", reason: "classify" }; // special marker
    }
    return { action: "allow" };
  }

  async function promptUser(
    toolName: string,
    input: Record<string, unknown>,
    reason: string,
    ctx: ExtensionContext & { signal?: AbortSignal },
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
        // Fallback: prompt user
        const choice = await ctx.ui.select(
          `⚠️ bash (Auto Mode — classifier unavailable)\n\n  ${command}\n\nAllow?`,
          ["Yes", "No"],
        );
        return choice === "Yes";
      }

      const result = await classifyBashCommand(command, ctx.cwd, config, ctx.signal);

      if (result.risk === "low") {
        return true; // Auto-allow low risk
      }

      // Medium or high risk — prompt user
      const riskLabel = result.risk === "high" ? "🔴 HIGH" : "🟡 MEDIUM";
      const choice = await ctx.ui.select(
        `⚠️ bash (Auto Mode — ${riskLabel} risk)\n\n  ${command}\n\n  Reason: ${result.reason}\n\nAllow?`,
        ["Yes", "No"],
      );
      return choice === "Yes";
    } catch {
      // Classification failed — prompt user
      const choice = await ctx.ui.select(
        `⚠️ bash (Auto Mode — classification failed)\n\n  ${command}\n\nAllow?`,
        ["Yes", "No"],
      );
      return choice === "Yes";
    }
  }

  function getClassifierConfig(ctx: ExtensionContext): ClassifierConfig | null {
    // Try Anthropic first, then OpenAI, then Google
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

    const googleKey = process.env.GOOGLE_API_KEY;
    if (googleKey) {
      // Google uses a different API format; fall through to null for now
      // Can be extended with Google-specific classification
      return null;
    }

    return null;
  }
```

Also add the missing `ExtensionContext` import at the top:

```typescript
// Change the import to:
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
```

- [ ] **Step 2: Commit**

```bash
git add extensions/permissions/index.ts
git commit -m "feat: add tool_call permission rules for all levels"
```

### Task 5: Write the /permissions command

**Files:**
- Modify: `extensions/permissions/index.ts`

- [ ] **Step 1: Register the /permissions command**

Insert after the `updateStatus` function, before the `tool_call` handler:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add extensions/permissions/index.ts
git commit -m "feat: add /permissions command with level 5 double-confirm"
```

### Task 6: Write the Shift+Tab shortcut and UI feedback

**Files:**
- Modify: `extensions/permissions/index.ts`

- [ ] **Step 1: Register the Shift+Tab shortcut**

Insert after the `/permissions` command registration:

```typescript
  // ── Shift+Tab shortcut — cycle permission levels ──
  pi.registerShortcut("shift+tab", {
    description: "Cycle permission level",
    handler: async (ctx) => {
      if (!ctx.hasUI) return;

      // Show the level names with current level marked
      const options = ([1, 2, 3, 4, 5] as PermissionLevel[]).map((l) => {
        const marker = l === currentLevel ? " ✓" : "";
        return `${LEVEL_STATUS[l]} — ${LEVEL_NAMES[l]}${marker}`;
      });

      const choice = await ctx.ui.select("Select permission level:", options);
      if (choice) {
        // Extract level number from the choice (it's the first number in the status string)
        const match = choice.match(/Level (\d)/);
        // Alternative: find by index
        const idx = options.indexOf(choice);
        if (idx >= 0) {
          await activateLevel((idx + 1) as PermissionLevel, ctx);
        }
      }
    },
  });
```

- [ ] **Step 2: Add session_start UI restoration for level 5 widget**

Update the `session_start` handler to also restore the level 5 warning widget:

In the `session_start` handler, after `updateStatus(ctx)`, add:

```typescript
    // Restore warning widget if level 5
    if (currentLevel === 5) {
      ctx.ui.setWidget("permissions-warning", [
        "⚠️ BYPASS MODE — All tool calls auto-approved without confirmation",
      ]);
    } else {
      ctx.ui.setWidget("permissions-warning", undefined);
    }
```

- [ ] **Step 3: Commit**

```bash
git add extensions/permissions/index.ts
git commit -m "feat: add Shift+Tab shortcut and UI feedback for permissions"
```

### Task 7: Write the set_permissions custom tool

**Files:**
- Modify: `extensions/permissions/index.ts`

- [ ] **Step 1: Register the set_permissions tool**

Insert after the shortcut registration:

```typescript
  // ── set_permissions tool — LLM can request level change ──
  pi.registerTool({
    name: "set_permissions",
    label: "Set Permissions",
    description:
      "Request to change the permission level. Levels: 1=Ask Permissions (prompt for writes/bash), 2=Accept Edits (auto-allow file edits), 3=Plan Mode (read-only), 4=Auto Mode (classify bash by risk), 5=Bypass (no prompts, requires user double-confirm). Use this when you need elevated permissions to complete a task.",
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
```

- [ ] **Step 2: Commit**

```bash
git add extensions/permissions/index.ts
git commit -m "feat: add set_permissions custom tool for LLM-initiated level changes"
```

### Task 8: Update package.json entry point

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the permissions extension to the pi.extensions array**

```bash
# Check current contents first
cat package.json
```

The current `package.json` already has `pi.extensions`:

```json
{
  "pi": {
    "extensions": ["./extensions/superpowers-bootstrap.ts"],
    "skills": ["./superpowers/skills"]
  }
}
```

Update it to include the permissions extension:

```json
{
  "name": "pi-extensions",
  "private": true,
  "keywords": ["pi-package"],
  "pi": {
    "extensions": [
      "./extensions/superpowers-bootstrap.ts",
      "./extensions/permissions/index.ts"
    ],
    "skills": ["./superpowers/skills"]
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "feat: register permissions extension in package.json"
```

### Task 9: Integration test — verify all levels work

**Files:**
- Create: `extensions/permissions/__tests__/levels.test.ts` (optional, if a test framework is available)

- [ ] **Step 1: Manual smoke test — verify extension loads**

```bash
# Install the local package into Pi
pi install .

# Start Pi and verify the extension loads without errors
# Check that the status line shows the current level
pi
```

Expected: No errors on startup. Footer status shows `🔒 Ask`.

- [ ] **Step 2: Test /permissions command**

In Pi:
1. Type `/permissions` — should show current level info
2. Type `/permissions 2` — should switch to Accept Edits, status shows `✏️ AcceptEdits`
3. Type `/permissions 3` — should switch to Plan Mode, status shows `📋 Plan`
4. Type `/permissions 4` — should switch to Auto Mode, status shows `🤖 Auto`
5. Type `/permissions 5` — double-confirm dialog, status shows `⚠️ ⚡ Bypass`, warning widget appears
6. Type `/permissions 1` — switch back to Ask, widget disappears

- [ ] **Step 3: Test Shift+Tab shortcut**

In Pi:
1. Press `Shift+Tab` — select dialog appears with all levels
2. Select a different level — should switch and update status

- [ ] **Step 4: Test Level 1 — Ask Permissions**

```
/permissions 1
# Then ask the LLM: "Write hello world to /tmp/hello.txt"
# Should prompt before writing
```

Expected: Confirmation dialog appears before `write` tool executes.

- [ ] **Step 5: Test Level 2 — Accept Edits**

```
/permissions 2
# Then ask the LLM: "Write hello world to ./test-output.txt"
# Should auto-allow (inside cwd)
# Then ask: "Write hello world to /tmp/hello-outside.txt"
# Should prompt (outside cwd)
```

Expected: Auto-allows writes inside cwd, prompts for outside.

- [ ] **Step 6: Test Level 3 — Plan Mode**

```
/permissions 3
# Then ask the LLM: "Write hello world to ./test.txt"
# Should block with reason
```

Expected: Tool call blocked with "Plan mode" message.

- [ ] **Step 7: Test Level 4 — Auto Mode (bash classification)**

```
/permissions 4
# Ensure ANTHROPIC_API_KEY is set for classifier
# Ask: "Run ls" — should auto-allow (low risk)
# Ask: "Run rm -rf /tmp/test-dir" — should prompt (high risk)
```

Expected: `ls` auto-allowed, `rm -rf` prompts with classification result.

- [ ] **Step 8: Test Level 5 — Bypass**

```
/permissions 5
# Double confirm
# Ask: "Write hello world to /tmp/hello-bypass.txt"
# Should auto-allow without any prompt
```

Expected: No permission prompts at all.

- [ ] **Step 9: Test set_permissions tool**

```
/permissions 3
# Ask: "Try to switch to level 2 to make edits"
# LLM should call set_permissions tool
# Confirm the dialog
```

Expected: Level successfully changed via tool call.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "test: add manual integration test documentation for permissions extension"
```

### Task 10: Final verification and cleanup

- [ ] **Step 1: Review the complete index.ts for consistency**

Read through `extensions/permissions/index.ts` and verify:
- All functions referenced are defined
- All imports are correct
- No unused variables
- The `activateLevel` function is defined before it's used by command/shortcut/tool

- [ ] **Step 2: Verify the extension loads cleanly**

```bash
pi -e extensions/permissions/index.ts --help
# Should show no errors
```

- [ ] **Step 3: Final commit**

```bash
git add extensions/permissions/index.ts
git commit -m "chore: final review and cleanup of permissions extension"
```
