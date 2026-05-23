# Corrective Review Subagent Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Pi extension that spawns a corrective review subagent once per prompt cycle (at `turn_end`), evaluating tool call history and draft response across intent alignment, lazy shortcuts, and evidence support before the response reaches the user.

**Architecture:** The extension hooks `turn_end` to intercept completed turns. It collects the original user prompt (from session), tool call history (from event), and draft response (from event), then uses `pi.sendMessage({ deliverAs: "steer" })` to inject a review task. The agent spawns the corrective review subagent via the `subagent` tool from `pi-subagents`. The subagent is read-only (no tools), with a fresh context and a dedicated system prompt describing the three-dimension review framework. If FAIL, feedback is injected as another steer to trigger re-tooling; a `max_review_cycles` counter prevents infinite loops.

**Tech Stack:** TypeScript (Pi extension), `@earendil-works/pi-coding-agent` ExtensionAPI, `pi-subagents` package, Node.js fs/path

**Dependency:** Requires `pi-subagents` package installed. The extension checks availability at startup and warns if missing.

---

## File Structure

```
extensions/corrective-review/
├── index.ts              # Extension entry: hooks turn_end, orchestrates review cycle
├── review-prompt.ts      # Subagent system prompt (3-dimension review framework)
├── review-subagent.ts    # Subagent definition + spawn logic via sendMessage steer
├── collector.ts          # Collects tool history + user prompt + draft response from session
└── config.ts             # max_review_cycles, dimension toggles, defaults
```

| File | Responsibility |
|------|---------------|
| `config.ts` | Default values for `maxReviewCycles`, dimension toggles. No dependencies. |
| `collector.ts` | Reads session entries to extract original user prompt, tool call history, and the draft response. Depends on ExtensionAPI types. |
| `review-prompt.ts` | Exports the subagent system prompt string. Defines the 3-dimension framework and PASS/FAIL output format. No dependencies. |
| `review-subagent.ts` | Defines the corrective-review subagent config (name, systemPrompt, tools: none, defaultContext: fresh, inheritSkills: false). Exports a function to build the review task string from collected data. |
| `index.ts` | Extension entry. Hooks `turn_end`, tracks review cycles per turn via a Map, orchestrates collection → review → re-tool or pass. Uses `pi.sendMessage()` with `deliverAs: "steer"` to inject review tasks. |

---

### Task 1: Configuration module

**Files:**
- Create: `extensions/corrective-review/config.ts`

- [ ] **Step 1: Write config.ts**

```typescript
// extensions/corrective-review/config.ts

export interface CorrectiveReviewConfig {
  /** Maximum number of review→re-tool cycles per prompt cycle (default: 2). */
  maxReviewCycles: number;
  /** Enable intent alignment dimension (🎯). */
  intentAlignment: boolean;
  /** Enable lazy shortcuts dimension (🏃). */
  lazyShortcuts: boolean;
  /** Enable evidence support dimension (🧾). */
  evidenceSupport: boolean;
}

export const DEFAULT_CONFIG: CorrectiveReviewConfig = {
  maxReviewCycles: 2,
  intentAlignment: true,
  lazyShortcuts: true,
  evidenceSupport: true,
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/panda/repo/pi-extensions && npx tsc --noEmit extensions/corrective-review/config.ts
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add extensions/corrective-review/config.ts
git commit -m "feat(corrective-review): add config module with defaults"
```

---

### Task 2: Review prompt template

**Files:**
- Create: `extensions/corrective-review/review-prompt.ts`

- [ ] **Step 1: Write review-prompt.ts**

```typescript
// extensions/corrective-review/review-prompt.ts

import type { CorrectiveReviewConfig } from "./config.ts";

export function buildReviewSystemPrompt(config: CorrectiveReviewConfig): string {
  const dimensions: string[] = [];

  if (config.intentAlignment) {
    dimensions.push(`### 1. Intent Alignment (🎯)
- Does the tool call chain serve the user's original intent?
- Are there causal chain breaks (agent drifted to unrelated tasks)?
- Is the tool choice appropriate for the intent? (e.g., web_search vs local grep)`);
  }

  if (config.lazyShortcuts) {
    dimensions.push(`### ${dimensions.length + 1}. Lazy Shortcuts (🏃)
- Did the agent give up too early?
- Were all reasonable paths attempted before concluding "not found"?
- Did the agent try only one source and declare a conclusion?`);
  }

  if (config.evidenceSupport) {
    dimensions.push(`### ${dimensions.length + 1}. Evidence Support (🧾)
- Are factual claims in the draft response backed by tool output?
- Is claim scope consistent with evidence scope? ("not found anywhere" vs "not found locally")
- Are there unverified assertions presented as facts?`);
  }

  const dimSection = dimensions.join("\n\n");

  return `You are a corrective review subagent. Your job is to review an agent's work and flag quality issues.

You receive:
- 🎯 The original user prompt
- 📊 Full tool call history (commands + outputs)
- 📝 The agent's draft response

Evaluate across these dimensions:

${dimSection}

## Output Format

Respond with EXACTLY one of these two words on the first line, followed by an explanation:

**PASS** — All dimensions check out. The agent's work is solid.
**FAIL** — One or more dimensions have issues. Explain which and suggest what to do.

## Rules

- You are READ-ONLY. Do not call tools. Only review what you see.
- Do not judge business logic correctness. Only process quality.
- Do not generate user-visible output outside this review.
- Be specific: cite tool call numbers and exact issues.
- A FAIL is serious. Only fail when there is clear evidence of a problem.`;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/panda/repo/pi-extensions && npx tsc --noEmit extensions/corrective-review/review-prompt.ts
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add extensions/corrective-review/review-prompt.ts
git commit -m "feat(corrective-review): add 3-dimension review system prompt"
```

---

### Task 3: Session data collector

**Files:**
- Create: `extensions/corrective-review/collector.ts`

- [ ] **Step 1: Write collector.ts**

```typescript
// extensions/corrective-review/collector.ts

import type {
  ReadonlySessionManager,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";

export interface ReviewInput {
  /** The original user prompt that started this cycle. */
  userPrompt: string;
  /** Tool call history: name, args, and result summary for each call. */
  toolHistory: ToolCallRecord[];
  /** The agent's draft response text. */
  draftResponse: string;
}

export interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  /** First 2000 chars of result content. */
  resultSummary: string;
  /** Whether the result was an error. */
  isError: boolean;
}

/**
 * Maximum characters of tool output to include per call.
 * Keeps the review subagent's context manageable.
 */
const MAX_RESULT_LENGTH = 2000;

/**
 * Collect review inputs from the session at turn end.
 *
 * @param sessionManager - Read-only session manager to scan entries.
 * @param turnToolResults - Tool result messages from the current turn_end event.
 * @param draftResponse - The assistant message content from the current turn_end event.
 */
export function collectReviewInput(
  sessionManager: ReadonlySessionManager,
  turnToolResults: Array<{
    role: "toolResult";
    toolCallId: string;
    content: string;
    isError?: boolean;
    details?: { command?: string };
  }>,
  draftResponse: string,
): ReviewInput {
  // 1. Extract original user prompt from session entries.
  //    Walk backward from the most recent entries to find the last user message
  //    that is NOT a corrective-review steer.
  const entries = sessionManager.getEntries();
  let userPrompt = "";

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry) continue;
    if (
      entry.role === "user" &&
      typeof entry.content === "string" &&
      !entry.content.includes("[CORRECTIVE-REVIEW]")
    ) {
      userPrompt = entry.content;
      break;
    }
  }

  // 2. Build tool call history from turn results.
  const toolHistory: ToolCallRecord[] = turnToolResults.map((result) => {
    const summary =
      typeof result.content === "string"
        ? result.content.slice(0, MAX_RESULT_LENGTH)
        : JSON.stringify(result.content).slice(0, MAX_RESULT_LENGTH);

    return {
      toolName: result.details?.command
        ? `bash: ${result.details.command}`
        : "unknown",
      args: {},
      resultSummary: summary || "(empty output)",
      isError: result.isError ?? false,
    };
  });

  return {
    userPrompt,
    toolHistory,
    draftResponse: draftResponse.slice(0, 4000),
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/panda/repo/pi-extensions && npx tsc --noEmit extensions/corrective-review/collector.ts
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add extensions/corrective-review/collector.ts
git commit -m "feat(corrective-review): add session data collector"
```

---

### Task 4: Subagent definition module

**Files:**
- Create: `extensions/corrective-review/review-subagent.ts`

- [ ] **Step 1: Write review-subagent.ts**

```typescript
// extensions/corrective-review/review-subagent.ts

import type { CorrectiveReviewConfig } from "./config.ts";
import { buildReviewSystemPrompt } from "./review-prompt.ts";
import type { ReviewInput } from "./collector.ts";

/** Agent name registered for the corrective review subagent. */
export const REVIEW_AGENT_NAME = "corrective-reviewer";

/**
 * Build the subagent definition object for pi-subagents.
 * This is passed as the `config` parameter to subagent's create action.
 */
export function buildReviewAgentConfig(config: CorrectiveReviewConfig) {
  return {
    name: REVIEW_AGENT_NAME,
    description: "Corrective review subagent — reviews agent work for intent alignment, lazy shortcuts, and evidence support",
    systemPrompt: buildReviewSystemPrompt(config),
    systemPromptMode: "replace" as const,
    inheritProjectContext: false,
    inheritSkills: false,
    defaultContext: "fresh" as const,
    tools: "", // No tools — read-only reviewer
    thinking: "low" as const,
  };
}

/**
 * Build the review task string that the main agent will pass to the subagent tool.
 */
export function buildReviewTask(input: ReviewInput): string {
  const toolHistoryStr = input.toolHistory
    .map(
      (call, i) =>
        `[${i + 1}] ${call.toolName}\n    Result: ${call.resultSummary}${call.isError ? " (ERROR)" : ""}`,
    )
    .join("\n\n");

  return `Review this agent's work:

## Original User Prompt
${input.userPrompt || "(not found)"}

## Tool Call History
${toolHistoryStr || "(no tool calls)"}

## Draft Response
${input.draftResponse}

Respond with PASS or FAIL on the first line, followed by your reasoning.`;
}

/**
 * Parse the review subagent's response to extract PASS/FAIL verdict.
 */
export function parseReviewVerdict(
  response: string,
): { verdict: "PASS" | "FAIL"; feedback: string } {
  const firstLine = response.trim().split("\n")[0] ?? "";
  const verdict = firstLine.toUpperCase().startsWith("PASS") ? "PASS" : "FAIL";
  const feedback = response.trim();
  return { verdict, feedback };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/panda/repo/pi-extensions && npx tsc --noEmit extensions/corrective-review/review-subagent.ts
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add extensions/corrective-review/review-subagent.ts
git commit -m "feat(corrective-review): add subagent definition and task builder"
```

---

### Task 5: Extension entry point (index.ts)

**Files:**
- Create: `extensions/corrective-review/index.ts`

- [ ] **Step 1: Write index.ts**

```typescript
// extensions/corrective-review/index.ts
//
// Corrective Review Extension
// Spawns a corrective review subagent once per prompt cycle at turn_end.
// Evaluates tool call history + draft response across 3 dimensions.
// On FAIL, injects feedback as a steer to trigger re-tooling.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, type CorrectiveReviewConfig } from "./config.ts";
import { collectReviewInput } from "./collector.ts";
import {
  buildReviewAgentConfig,
  buildReviewTask,
  parseReviewVerdict,
  REVIEW_AGENT_NAME,
} from "./review-subagent.ts";

export default function (pi: ExtensionAPI) {
  const config: CorrectiveReviewConfig = { ...DEFAULT_CONFIG };

  // ── Track review cycles per prompt to enforce max_review_cycles ──────

  /** Counts review cycles per prompt. Reset when a new user message arrives. */
  let currentCycleCount = 0;
  /** Tracks whether we've registered the review agent this session. */
  let agentRegistered = false;

  // ── Subagent availability check ──────────────────────────────────────

  function checkSubagentAvailable(): boolean {
    return pi.getAllTools().some((t) => t.name === "subagent");
  }

  // ── Session lifecycle ────────────────────────────────────────────────

  pi.on("session_start", (_event, ctx) => {
    currentCycleCount = 0;
    agentRegistered = false;

    if (!checkSubagentAvailable()) {
      ctx.ui.notify(
        "corrective-review: pi-subagents package required. Install: pi install npm:pi-subagents",
        "warning",
      );
      return;
    }

    ctx.ui.notify("Corrective Review active · max 2 cycles", "info");
  });

  // ── Reset cycle count on new user input ──────────────────────────────

  pi.on("input", (_event, _ctx) => {
    currentCycleCount = 0;
  });

  // ── Review gate at turn_end ──────────────────────────────────────────

  pi.on("turn_end", (event, ctx) => {
    // Skip if subagent tool not available
    if (!checkSubagentAvailable()) return;

    // Skip if no tool calls were made (conversational turns don't need review)
    if (event.toolResults.length === 0) return;

    // Skip if we've hit max review cycles for this prompt
    if (currentCycleCount >= config.maxReviewCycles) {
      currentCycleCount = 0;
      return;
    }

    // Extract draft response text
    const draftResponse =
      typeof event.message.content === "string"
        ? event.message.content
        : JSON.stringify(event.message.content);

    // Collect review inputs
    const reviewInput = collectReviewInput(
      ctx.sessionManager,
      event.toolResults,
      draftResponse,
    );

    // Increment cycle count
    currentCycleCount++;

    // Register the review agent on first use
    if (!agentRegistered) {
      const agentConfig = buildReviewAgentConfig(config);
      const createPayload = JSON.stringify({
        action: "create",
        config: agentConfig,
      });
      pi.sendMessage(
        {
          customType: "corrective-review-setup",
          content: `[CORRECTIVE-REVIEW] Register agent: ${createPayload}`,
          display: false,
        },
        { deliverAs: "steer" },
      );
      agentRegistered = true;
    }

    // Build review task
    const reviewTask = buildReviewTask(reviewInput);

    // Build the subagent invocation payload
    const subagentPayload = JSON.stringify({
      agent: REVIEW_AGENT_NAME,
      task: reviewTask,
    });

    // Inject review as a steer message
    // The agent will call subagent tool, parse result, and decide PASS/FAIL
    pi.sendMessage(
      {
        customType: "corrective-review",
        content: `[CORRECTIVE-REVIEW cycle ${currentCycleCount}/${config.maxReviewCycles}]

You MUST call the subagent tool with exactly this payload:
${subagentPayload}

The review subagent returns PASS or FAIL.
- If PASS: respond with "✅ Review passed" (short, no extra text).
- If FAIL: read the feedback and go back to tool calling to fix the issues. Do NOT respond to the user yet.

Do not respond to the user until review passes or max cycles reached.`,
        display: false,
      },
      { deliverAs: "steer" },
    );
  });

  // ── Cleanup ──────────────────────────────────────────────────────────

  pi.on("session_shutdown", () => {
    currentCycleCount = 0;
    agentRegistered = false;
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/panda/repo/pi-extensions && npx tsc --noEmit extensions/corrective-review/index.ts
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add extensions/corrective-review/index.ts
git commit -m "feat(corrective-review): add extension entry point with turn_end gate"
```

---

### Task 6: Register extension in package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add corrective-review to pi.extensions array**

```bash
cd /Users/panda/repo/pi-extensions
```

Edit `package.json` — in the `pi.extensions` array, add `"./extensions/corrective-review/index.ts"`:

```json
{
  "name": "pi-extensions",
  "private": true,
  "keywords": ["pi-package"],
  "pi": {
    "extensions": [
      "./extensions/superpowers-bootstrap.ts",
      "./ralph-loop/extensions/index.ts",
      "./extensions/corrective-review/index.ts"
    ],
    "skills": [
      "./superpowers/skills",
      "./ralph-loop/skills"
    ],
    "prompts": [
      "./ralph-loop/prompts"
    ]
  }
}
```

- [ ] **Step 2: Verify the edit**

```bash
cat package.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['pi']['extensions'])"
```

Expected output includes `"./extensions/corrective-review/index.ts"`.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(corrective-review): register extension in package.json"
```

---

### Task 7: Manual verification test

**Files:**
- Create: `extensions/corrective-review/__tests__/smoke-test.md`

- [ ] **Step 1: Write smoke test instructions**

```markdown
# Corrective Review — Smoke Test

## Prerequisites
- pi-subagents installed: `pi install npm:pi-subagents`
- Extension registered in package.json
- Run Pi from the pi-extensions directory

## Test 1: Extension loads

Start Pi and check the session_start notification:
- Expected: "Corrective Review active · max 2 cycles" appears

## Test 2: Simple question (no tool calls → no review)

Ask: "What is 2+2?"
- Expected: Normal response, no review subagent spawned

## Test 3: Tool call triggers review

Ask: "Search the web for 'TypeScript 5.8 release date' and tell me"
- Expected: Agent does web_search, then before responding to user, corrective review subagent spawns
- If PASS: response shown to user
- If FAIL: agent re-tools with feedback

## Test 4: Lazy shortcut detection

Ask: "Find the file AGENTS.md in this project"
- Pathological case: Agent does `ls` once, no result, says "not found"
- Expected: Review subagent flags lazy shortcut (only tried ls)
- Agent should retry with find/rg

## Test 5: Max cycles enforcement

Intentionally trigger failures to verify the 2-cycle limit.
- After 2 review cycles, the response is sent regardless.
```

- [ ] **Step 2: Commit**

```bash
git add extensions/corrective-review/__tests__/smoke-test.md
git commit -m "test(corrective-review): add smoke test instructions"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ Architecture: extension hooks into turn_end → review subagent spawned → PASS/FAIL gate (Task 5)
- ✅ 3-dimension review framework: intent alignment, lazy shortcuts, evidence support (Task 2)
- ✅ Subagent read-only, fresh context, no skills (Task 4)
- ✅ FAIL returns to tool loop with feedback (Task 5)
- ✅ max_review_cycles default 2 (Task 1, enforced in Task 5)
- ✅ Global scope — all Pi conversations (extension loads on startup)
- ✅ Integration with ralph-loop (global scope covers ralph-loop worker subagents)
- ✅ Extension structure matches spec: index.ts, review-subagent.ts, review-prompt.ts, config.ts
- ⚠️ Subagent spawn mechanism uses `pi.sendMessage()` + steer injection rather than direct executor call. This is because pi-subagents doesn't expose its executor publicly. The steer approach lets the main agent invoke the subagent tool. If this proves unreliable, a future iteration can implement direct subprocess spawning (e.g., `pi -p "review..."`).

**2. Placeholder scan:** No TBD, TODO, or vague references found. All code is concrete.

**3. Type consistency:**
- `ReviewInput` type defined in collector.ts (Task 3), used in review-subagent.ts (Task 4), consumed in index.ts (Task 5). ✅
- `CorrectiveReviewConfig` defined in config.ts (Task 1), used in review-prompt.ts (Task 2) and review-subagent.ts (Task 4). ✅
- `REVIEW_AGENT_NAME` constant defined in review-subagent.ts (Task 4), used in index.ts (Task 5). ✅
