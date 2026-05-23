# Corrective Review Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the corrective-review Pi extension (v3 subprocess-based, message_end pre-response gate) with tests, edge-case handling, and end-to-end validation.

**Architecture:** The extension hooks `message_end` to intercept assistant responses before rendering. It spawns a standalone `pi -p` subprocess to review the agent's work across 3 dimensions (Intent Alignment, Lazy Shortcuts, Evidence Support). On FAIL, it replaces the message and injects a steer to trigger re-tooling. Tool results are collected inline via `tool_result` events.

**Tech Stack:** TypeScript, Pi ExtensionAPI, Node.js built-ins (fs, os, path), pi.exec subprocess spawning

**Current state:** Core implementation exists with uncommitted changes (agent_end→message_end migration, inline tool collection, markdown-stripping verdict parser). Branch: `main` (needs commit).

---

## Task 1: Add tests for parseReviewVerdict

**Files:**
- Create: `extensions/corrective-review/__tests__/review-prompt.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// extensions/corrective-review/__tests__/review-prompt.test.ts

import { parseReviewVerdict } from "../review-prompt.ts";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// ── Basic verdict parsing ─────────────────────────────────────────────

test("parses plain PASS", () => {
  const result = parseReviewVerdict("PASS\nAll good here.");
  assert(result.verdict === "PASS", `Expected PASS, got ${result.verdict}`);
  assert(result.feedback === "PASS\nAll good here.", `Feedback should be full response`);
});

test("parses plain FAIL", () => {
  const result = parseReviewVerdict("FAIL\nLazy shortcut detected.");
  assert(result.verdict === "FAIL", `Expected FAIL, got ${result.verdict}`);
  assert(result.feedback.includes("Lazy shortcut"), "Feedback should include reason");
});

// ── Markdown formatting variants ──────────────────────────────────────

test("parses **PASS** with bold markdown", () => {
  const result = parseReviewVerdict("**PASS**\nEverything looks solid.");
  assert(result.verdict === "PASS", `Expected PASS, got ${result.verdict}`);
});

test("parses *FAIL* with italic markdown", () => {
  const result = parseReviewVerdict("*FAIL*\nMissing evidence.");
  assert(result.verdict === "FAIL", `Expected FAIL, got ${result.verdict}`);
});

test("parses ## PASS with heading markdown", () => {
  const result = parseReviewVerdict("## PASS\n\nAll checks passed.");
  assert(result.verdict === "PASS", `Expected PASS, got ${result.verdict}`);
});

test("parses **PASS:** with trailing colon", () => {
  const result = parseReviewVerdict("**PASS:** All checks passed.");
  assert(result.verdict === "PASS", `Expected PASS, got ${result.verdict}`);
});

test("parses ___FAIL___ with triple underscore", () => {
  const result = parseReviewVerdict("___FAIL___\nProblems found.");
  assert(result.verdict === "FAIL", `Expected FAIL, got ${result.verdict}`);
});

// ── Edge cases ────────────────────────────────────────────────────────

test("handles leading whitespace on first line", () => {
  const result = parseReviewVerdict("  \t  PASS\nAll good.");
  assert(result.verdict === "PASS", `Expected PASS, got ${result.verdict}`);
});

test("handles # FAIL: with colon", () => {
  const result = parseReviewVerdict("# FAIL: Intent misalignment detected.");
  assert(result.verdict === "FAIL", `Expected FAIL, got ${result.verdict}`);
});

test("defaults to FAIL for unrecognized first line", () => {
  const result = parseReviewVerdict("UNCLEAR\nNot sure what to do.");
  assert(result.verdict === "FAIL", `Expected FAIL for unrecognized, got ${result.verdict}`);
});

test("handles empty response gracefully", () => {
  const result = parseReviewVerdict("");
  assert(result.verdict === "FAIL", `Expected FAIL for empty, got ${result.verdict}`);
  assert(result.feedback === "", "Feedback should be empty string");
});

test("handles single-line PASS without newline", () => {
  const result = parseReviewVerdict("PASS");
  assert(result.verdict === "PASS", `Expected PASS, got ${result.verdict}`);
});

test("handles multiline response with PASS word in body", () => {
  // Only the first line matters, "PASS" in body shouldn't flip verdict
  const result = parseReviewVerdict("FAIL\nBut the agent did pass some checks.");
  assert(result.verdict === "FAIL", "FAIL on first line should win");
});

test("case-insensitive pass detection", () => {
  const result = parseReviewVerdict("pass\nall good");
  assert(result.verdict === "PASS", `Expected PASS for lowercase, got ${result.verdict}`);
});

test("case-insensitive with mixed casing", () => {
  const result = parseReviewVerdict("Pass\nall good");
  assert(result.verdict === "PASS", `Expected PASS for mixed case, got ${result.verdict}`);
});

// ── Summary ───────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails (if parseReviewVerdict has bugs)**

Run: `npx tsx extensions/corrective-review/__tests__/review-prompt.test.ts`

Check that each edge case passes. If any fail, fix `parseReviewVerdict` in the next step.

- [ ] **Step 3: Fix parseReviewVerdict if needed**

If any tests fail, the markdown stripping regex or .toUpperCase() logic needs adjustment. Common issue: the regex `/^[*_#\s]+/` won't strip leading whitespace before markdown. Fix:

```typescript
export function parseReviewVerdict(
  response: string,
): { verdict: "PASS" | "FAIL"; feedback: string } {
  let firstLine = response.trim().split("\n")[0] ?? "";
  firstLine = firstLine
    .replace(/^[*_#\s]+/, "")
    .replace(/[*_\s:]+$/, "")
    .trim();
  const verdict = firstLine.toUpperCase().startsWith("PASS") ? "PASS" : "FAIL";
  const feedback = response.trim();
  return { verdict, feedback };
}
```

Note: the `.trim()` at the start is needed because the regex `\s` inside `[...]+` includes whitespace, but the line might start with * markdown *before* the leading whitespace. The leading `.trim()` handles that case.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx extensions/corrective-review/__tests__/review-prompt.test.ts`
Expected: All ✓, `0 failed`

- [ ] **Step 5: Commit**

```bash
git add extensions/corrective-review/__tests__/review-prompt.test.ts
git commit -m "test: add parseReviewVerdict edge case tests"
```

---

## Task 2: Verify and commit current implementation changes

**Files:**
- Modify: `extensions/corrective-review/index.ts` (already changed, review+commit)
- Modify: `extensions/corrective-review/review-prompt.ts` (already changed, review+commit)

- [ ] **Step 1: Review the diff for correctness**

The uncommitted changes switch from `agent_end` to `message_end` with inline tool result collection. Key changes to verify:

a) **`message_end` filter logic**: Only reviews final assistant messages (no tool_calls). Check that `hasToolCalls` check works with Pi's content format - tools are `{ type: "toolCall", ... }` blocks in assistant messages.

b) **`tool_result` collection**: Collects results inline. Verify that `extractText(event.content)` handles both string and array content types.

c) **Message replacement on FAIL**: Returns `{ message: {...} }` which is the `MessageEndEventResult` shape. This replaces the message before rendering. The replaced message has `role: "assistant"` (required by the API - "The replacement must keep the original message role").

d) **`display: true` on steer feedback**: Changed from `false` to `true`. This means the feedback text will be visible to the user. Verify this is intentional - the replaced message + steer together provide transparency.

e) **Status display**: `ctx.ui.setStatus("corrective-review", ...)` shows "🔍 Reviewing" during the subprocess. Cleared after. Verify `setStatus` doesn't throw if UI isn't available (it shouldn't based on API design).

- [ ] **Step 2: Fix any issues found in review**

If the review finds problems, fix them in `index.ts`.

- [ ] **Step 3: Run existing collector tests**

Run: `npx tsx extensions/corrective-review/__tests__/collector-agent-end.test.ts`
Expected: All ✓, `0 failed`

- [ ] **Step 4: Commit**

```bash
git add extensions/corrective-review/index.ts extensions/corrective-review/review-prompt.ts
git commit -m "feat: switch corrective review to message_end pre-response gate with inline tool collection"
```

---

## Task 3: Add robustness to parseReviewVerdict for subprocess output edge cases

**Files:**
- Modify: `extensions/corrective-review/review-prompt.ts`

The review subprocess (`pi -p`) may produce output with:
- ANSI escape codes if terminal mode leaks through
- Empty/non-existent output if the subprocess crashes
- Multi-paragraph responses where the first "line" is just whitespace

- [ ] **Step 1: Add ANSI escape code stripping**

Modify `parseReviewVerdict` in `review-prompt.ts`:

```typescript
// ANSI escape code regex (for stripping color codes)
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

export function parseReviewVerdict(
  response: string,
): { verdict: "PASS" | "FAIL"; feedback: string } {
  // Strip ANSI escape codes first
  const clean = response.replace(ANSI_REGEX, "");

  // Find the first non-empty line
  const lines = clean.trim().split("\n");
  let firstLine = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      firstLine = trimmed;
      break;
    }
  }

  // Fall back to empty string if all lines are empty
  if (firstLine === "") {
    return { verdict: "FAIL", feedback: "(empty review output)" };
  }

  // Strip markdown formatting: **, *, _, #, whitespace, trailing colons
  firstLine = firstLine
    .replace(/^[*_#\s]+/, "")
    .replace(/[*_\s:]+$/, "")
    .trim();

  const verdict = firstLine.toUpperCase().startsWith("PASS") ? "PASS" : "FAIL";
  const feedback = clean.trim();
  return { verdict, feedback };
}
```

- [ ] **Step 2: Add test for ANSI stripping**

Add to `review-prompt.test.ts`:

```typescript
test("strips ANSI escape codes from output", () => {
  const result = parseReviewVerdict("\x1b[32mPASS\x1b[0m\nAll clear.");
  assert(result.verdict === "PASS", `Expected PASS, got ${result.verdict}`);
});

test("handles output with only empty lines before verdict", () => {
  const result = parseReviewVerdict("\n\n   \nPASS\nAll good.");
  assert(result.verdict === "PASS", `Expected PASS, got ${result.verdict}`);
});

test("handles output with only whitespace", () => {
  const result = parseReviewVerdict("   \n  \n  ");
  assert(result.verdict === "FAIL", "All whitespace should default to FAIL");
  assert(result.feedback === "(empty review output)", "Should indicate empty output");
});
```

- [ ] **Step 3: Run tests to verify**

Run: `npx tsx extensions/corrective-review/__tests__/review-prompt.test.ts`
Expected: All ✓, `0 failed`

- [ ] **Step 4: Commit**

```bash
git add extensions/corrective-review/review-prompt.ts extensions/corrective-review/__tests__/review-prompt.test.ts
git commit -m "fix: add ANSI stripping and empty-output handling to parseReviewVerdict"
```

---

## Task 4: End-to-end smoke test

**Files:**
- Modify: `extensions/corrective-review/__tests__/smoke-test.md` (already exists, verify)

- [ ] **Step 1: Install the extension locally**

Run: `pi install .` from `/Users/panda/repo/pi-extensions`
Expected: Extension registers successfully, no errors.

- [ ] **Step 2: Test 1 — Extension loads**

Start Pi and check for the notification: "Corrective Review active · max 2 cycles (pre-response gate)"

- [ ] **Step 3: Test 2 — Simple question (no tool calls → no review)**

Ask: "What is 2+2?"
Expected: Normal response, no review subprocess spawned, no status messages.

- [ ] **Step 4: Test 3 — Tool call triggers review (PASS case)**

Ask: "Search the web for 'TypeScript 5.8 release date' and tell me what you find"
Expected: 
- Agent does web_search
- Before response: status shows "🔍 Reviewing (1/2)…"
- Review subprocess spawned
- Notification: "Review ✅ PASS · cycle 1/2"
- Response shown to user

- [ ] **Step 5: Test 4 — Lazy shortcut detection (FAIL case)**

Ask: "Find the file AGENTS.md anywhere in this project" while in a directory where AGENTS.md does NOT exist nearby but IS in a parent/ancestor.
Expected scenario:
- Agent does `ls` once at current level, finds nothing, drafts "not found" response
- Review subprocess flags lazy shortcut (only tried `ls`, didn't search recursively)
- Notification: "Review ❌ FAIL · cycle 1/2"
- Agent retries with `find` or `rg`
- Second review on new tools: should PASS if the agent searches properly

- [ ] **Step 6: Test 5 — Max cycles enforcement**

Trigger repeated FAILs. After 2 cycles, the response goes through regardless.

- [ ] **Step 7: Update smoke-test.md with results**

Document which tests passed/failed in the smoke test file.

- [ ] **Step 8: Commit smoke test results**

```bash
git add extensions/corrective-review/__tests__/smoke-test.md
git commit -m "docs: update smoke test results"
```

---

## Task 5: Add extension README

**Files:**
- Create: `extensions/corrective-review/README.md`

- [ ] **Step 1: Write the README**

```markdown
# Corrective Review Extension

A Pi extension that reviews the agent's work before responses are sent to the user. Spawns a standalone `pi -p` subprocess to evaluate tool call history and draft responses across three dimensions, then intervenes when quality issues are detected.

## How It Works

1. **Collect** — Extension tracks tool calls and outputs during the prompt cycle via `tool_result` events.
2. **Gate** — At `message_end`, when the assistant is about to send a final response, the extension spawns a `pi -p` subprocess.
3. **Review** — The subprocess evaluates the agent's work across 3 dimensions:
   - 🎯 **Intent Alignment** — Did tool calls serve the original user intent?
   - 🏃 **Lazy Shortcuts** — Did the agent give up too early?
   - 🧾 **Evidence Support** — Are claims backed by tool output?
4. **Verdict** — PASS → response sent to user. FAIL → message replaced, steer injected, agent re-tools (up to 2 cycles).

## Configuration

Configurable in `config.ts`:

| Setting | Default | Description |
|---------|---------|-------------|
| `maxReviewCycles` | `2` | Max review→re-tool cycles per prompt |
| `intentAlignment` | `true` | Enable 🎯 dimension |
| `lazyShortcuts` | `true` | Enable 🏃 dimension |
| `evidenceSupport` | `true` | Enable 🧾 dimension |
| `reviewModel` | `undefined` | Model for review subprocess (defaults to session model) |

## Architecture

```
User Prompt → Tool Loop → Draft Response
                              ↓
                     🚪 message_end gate
                              ↓
                    pi -p subprocess spawn
                    (--no-extensions, --no-skills)
                              ↓
                    PASS → user sees response
                    FAIL → replace message + steer → re-tool
```

The review subprocess runs in an isolated context — no extensions, no skills, read-only. It only reviews the evidence presented.

## Testing

```bash
# Unit tests
npx tsx extensions/corrective-review/__tests__/review-prompt.test.ts
npx tsx extensions/corrective-review/__tests__/collector-agent-end.test.ts

# Smoke test (requires interactive Pi session)
# See __tests__/smoke-test.md
```

## Design Decisions

- **Subprocess, not subagent** — The review runs as `pi -p` (print mode), not as a subagent. The extension parses the verdict directly without relying on the agent to call a subagent tool.
- **message_end, not agent_end** — Intercepts at message_end (before rendering), so FAIL verdicts replace the message before the user sees it.
- **Inline collection, not extractReviewFromAgentEnd** — Tool results are collected as they happen via `tool_result` events, avoiding the need to scan all messages at the end.
- **Read-only reviewer** — The subprocess has no tools. It only evaluates the evidence.
```

- [ ] **Step 2: Commit**

```bash
git add extensions/corrective-review/README.md
git commit -m "docs: add corrective-review extension README"
```

---

## Task 6: Final verification — run all tests

**Files:** None (verification only)

- [ ] **Step 1: Run collector tests**

Run: `npx tsx extensions/corrective-review/__tests__/collector-agent-end.test.ts`
Expected: All ✓, `0 failed`

- [ ] **Step 2: Run verdict parser tests**

Run: `npx tsx extensions/corrective-review/__tests__/review-prompt.test.ts`
Expected: All ✓, `0 failed`

- [ ] **Step 3: Verify git status is clean**

```bash
git status
```
Expected: All changes committed.

- [ ] **Step 4: Display summary**

Print all test results and confirmation that the extension is ready.
```

---

## Self-Review

### 1. Spec coverage check

| Spec requirement | Covered by |
|-----------------|-----------|
| Extension hooks into response pipeline | Task 2 (message_end gate) |
| Three-dimension review (🎯🏃🧾) | Task 2 (review-prompt.ts already has this) |
| Subprocess spawning via pi.exec | Task 2 (already implemented) |
| PASS/FAIL verdict → forward or re-tool | Task 2 (message replacement + steer injection) |
| max_review_cycles enforcement | Task 2 (already implemented) |
| Read-only reviewer | Task 2 (--no-extensions, --no-skills, no tools) |
| Global scope (all conversations) | Task 2 (registered in package.json) |
| Configurable dimensions | Task 5 (README documents config.ts) |
| Subprocess approach (not subagent) | Task 2 (pi.exec instead of subagent tool) |
| Tests for collector | Task 2 (existing test) |
| Tests for verdict parsing | Tasks 1 & 3 |
| Smoke tests | Task 4 |
| Documentation | Task 5 |
| Direct subprocess spawning (future iteration doc) | Already documented in `docs/corrective-review-subprocess-spawning-handoff.md` |

No gaps found — all spec requirements are covered.

### 2. Placeholder scan

No TBD, TODO, "implement later", "add appropriate error handling", or vague references found. All steps have concrete code and exact commands.

### 3. Type consistency

- `ReviewInput` interface used consistently across collector.ts, index.ts, and review-prompt.ts ✓
- `ToolCallRecord` used in both collector.ts (export) and index.ts (import) ✓
- `CorrectiveReviewConfig` used in config.ts, index.ts, and review-prompt.ts ✓
- `MessageEndEventResult.message` matches Pi API: `{ message?: AgentMessage }` ✓
