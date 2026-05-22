# Corrective Review Subagent — Design Spec

**Date:** 2026-05-22
**Status:** Draft

## Overview

This is a **Pi extension** (`corrective-review`). Once installed (`pi install ...`), it auto-activates for **all** Pi conversations globally. It hooks into the agent's response pipeline and spawns a corrective review subagent once per prompt cycle, before any response is sent to the user.

- **Type:** Pi extension
- **Scope:** Global (all conversations)
- **Dependencies:** `pi-subagents` package (for spawning review subagent)
- **Not** a skill, not part of ralph-loop

## Problem

LLM coding agents exhibit high-confidence errors in several forms:

1. **Intent misalignment** — Agent uses wrong tools for the job (e.g., `rg` local files when user asked for `web_search`).
2. **Lazy shortcuts** — Agent tries one approach, gets no results, and declares "not found" without exploring reasonable alternatives.
3. **Unverified assertions** — Agent makes factual claims in responses without tool output evidence to back them.
4. **Result misinterpretation** — Agent reads tool output incorrectly (e.g., `ls -la` showing `total 0` for parent dir, concluding subdirectories are empty).

These errors are relatively rare (~1% of actions), so a heavyweight per-action check is wasteful. But when they happen in responses to users, the damage is high.

## Solution: Single-Gate Corrective Review

A lightweight correction subagent spawned **once per prompt cycle**, at the final gate before the response is sent to the user.

### Architecture

```
① User Prompt
     ↓
② Context Assembly
     ↓
③ Skill Matching
     ↓
④ Skill Loading
     ↓
⑤ Tool Call Loop (natural, uninterrupted)
     ↓
⑤→⑥ Self-Review (inline prompt, no subagent spawned)
     ↓
⑥ Result Interpretation
     ↓
⑦ Reasoning & Draft Response
     ↓
⑧ 🚪 CORRECTIVE REVIEW SUBAGENT (spawned once)
     ↓
⑨ Output to User
```

### Stage ⑤→⑥: Inline Self-Review

After the tool call loop concludes, the agent runs a lightweight self-review via an inline prompt (no subagent spawned):

> "Review all tool call results: any truncated output? any command-result mismatch? Need to retry with a different approach? If yes, go back to tool calling. If no, continue."

The agent decides autonomously whether to retry or proceed. No external process interrupts the natural think→act→observe loop.

### Stage ⑧: Corrective Review Subagent

Spawned once per prompt cycle. It receives three inputs:

| Input | Description |
|-------|-------------|
| 🎯 Original user prompt | The exact user instruction that started this cycle |
| 📊 Full tool call history | Every command issued and its complete output (stdout + stderr) |
| 📝 Draft response | The agent's proposed response before sending to user |

It evaluates the session across **three dimensions**:

#### 1. Intent Alignment (🎯)
- Does the tool call chain serve the user's original intent?
- Are there causal chain breaks (agent drifted to unrelated tasks)?
- Is the tool choice appropriate for the intent? (web_search vs local grep)

#### 2. Lazy Shortcuts (🏃)
- Did the agent give up too early?
- Were all reasonable paths attempted before concluding "not found"?
- Did the agent try only one source and declare a conclusion?

#### 3. Evidence Support (🧾)
- Are factual claims in the draft response backed by tool output?
- Is claim scope consistent with evidence scope? ("not found anywhere" vs "not found locally")
- Are there unverified assertions presented as facts?

#### Output

The subagent produces a structured review:

```
PASS / FAIL
If FAIL: specific feedback on which dimension(s) failed, with suggestion
```

- **PASS** → Response sent to user (⑨)
- **FAIL** → Agent returns to tool call loop (⑤) with the subagent's feedback, to gather missing evidence

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **One subagent per cycle, not per tool call** | Most tool calls are correct. Checking 100% to catch ~1% errors is wasteful in latency and tokens. |
| **Subagent at response gate, not in tool loop** | The tool loop is the agent's core competency. Interrupting it breaks the natural think→act→observe flow. |
| **Three-dimensional review** | Covers the three most impactful error categories without overloading the subagent with too many responsibilities. |
| **Subagent is read-only** | Does not execute its own tools. Only reviews the evidence presented. Keeps it lightweight and fast. |
| **FAIL returns to tool loop** | When the review fails, the agent gets specific feedback and can correct course naturally through additional tool calls, then re-draft and re-submit. |

### What the Subagent Does NOT Do

- ❌ Execute its own tool calls
- ❌ Judge business logic correctness (only process quality)
- ❌ Make decisions for the main agent (only flags issues)
- ❌ Generate user-visible output
- ❌ Repeat the main agent's reasoning

### Scope and Limitations

- The subagent can only catch errors visible in the tool call history. It cannot catch errors where the tool call history itself contains fabricated results (hallucinated tool outputs).
- Causal chain analysis for intent alignment relies on the subagent's ability to trace reasoning steps. Very long tool call chains may degrade this capability.
- The subagent's review quality is bounded by the underlying model's reasoning capability. However, a second independent pass by a fresh context statistically reduces error probability.

## Example

### Scenario: User asks "Why does React 19 have this feature?"

**Tool call history:**
1. `rg "React 19 feature" ~/docs/` → 0 results
2. `read ~/docs/react-19.md` → file locked

**Draft response:** "未找到关于 React 19 该特性的相关文档。"

**Subagent review:**
- 🎯 Intent: User asked about external knowledge. Local search is reasonable starting point but incomplete. 🟡
- 🏃 Lazy: Only tried local. Never attempted web_search or fetch_content. 🔴
- 🧾 Evidence: Claims "未找到" but evidence only covers local scope. 🔴

**Result:** 🔴 FAIL → Return to ⑤ with suggestion to use web_search

### Scenario: Agent properly researched

**Tool call history:**
1. `web_search "React 19 features"` → 3 relevant articles
2. `fetch_content react.dev/blog` → official explanation
3. `fetch_content github.com/.../issue` → community discussion

**Draft response:** "根据 React 官方文档，这个特性被引入是因为..."

**Subagent review:**
- 🎯 Intent: Searched web + official + community ✓
- 🏃 Lazy: Multiple sources attempted ✓
- 🧾 Evidence: Each claim cites specific source ✓

**Result:** 🟢 PASS → Send to user

## Implementation Approach

### Extension Structure

The extension lives at `extensions/corrective-review/` and registers itself in the root `package.json`:

```
pi-extensions/
├── package.json                          # add "./extensions/corrective-review/index.ts"
└── extensions/
    └── corrective-review/
        ├── index.ts                      # extension entry, hooks into Pi pipeline
        ├── review-subagent.ts            # subagent spawn logic
        ├── review-prompt.ts              # subagent system prompt template
        └── config.ts                     # max_cycles, enabled dimensions, defaults
```

### Pi Extension Hook

The extension hooks into Pi's response pipeline. Before the agent's response is sent to the user, it:

1. Collects the session's tool call history (commands + outputs)
2. Collects the original user prompt
3. Receives the agent's draft response
4. Spawns the corrective review subagent
5. Based on subagent verdict: either forward the response or inject feedback to trigger additional tool calls

### Subagent Configuration

The review subagent is defined as a Pi subagent with:

- `defaultContext: "fresh"` — independent context, no contamination
- `inheritSkills: false` — no skill loading, keeps it focused
- `inheritProjectContext: false` — only receives the three review inputs
- System prompt: the three-dimension review framework
- Tools: none (read-only reviewer)

### Integration with ralph-loop

Since the extension is global, ralph-loop worker subagents also get reviewed. This is desirable — it means ralph-loop iterations are each validated before their results are written to disk.

## Future Considerations

- `max_review_cycles` to prevent infinite retry loops (suggest default: 2, configurable via `config.ts`)
- Per-dimension enable/disable toggle (e.g., user might want only 🏃 lazy shortcut detection)
- Structured output format for easier integration with harness
- Review quality metrics: track PASS/FAIL rates and false positive/negative ratios over time
- Potential for the subagent to learn from past reviews (stateful correction patterns)
- Opt-out mechanism: per-session or per-project disable flag for power users
