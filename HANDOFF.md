# Handoff: Corrective Review Subagent Extension

**Date:** 2026-05-22
**Branch:** `dev`
**Status:** Design approved, ready for `writing-plans`

## What We're Building

A **Pi extension** that spawns a corrective review subagent once per prompt cycle, before any response is sent to the user. It reviews:

1. 🎯 **Intent Alignment** — Did the tool calls serve the original user intent?
2. 🏃 **Lazy Shortcuts** — Did the agent give up too early?
3. 🧾 **Evidence Support** — Are claims backed by tool output?

## Current State

- ✅ Design complete (v7 of the flowchart)
- ✅ Spec written: `docs/superpowers/specs/2026-05-22-corrective-review-subagent-design.md`
- ✅ Spec committed to `dev` branch
- ⬜ Next: `writing-plans` → implementation plan
- ⬜ Then: implement the extension

## Architecture Summary

```
①→④  Normal agent pipeline (unchanged)
  ⑤  Tool call loop (natural, uninterrupted)
⑤→⑥  Inline self-review prompt (no subagent)
  ⑥  Result interpretation
  ⑦  Reasoning & draft response
  ⑧  🚪 Corrective Review Subagent (spawned ONCE per cycle)
  ⑨  Output to user
```

The subagent is read-only. If it FAILs, the agent goes back to ⑤ with feedback.

## Extension Structure (planned)

```
extensions/corrective-review/
├── index.ts              # Pi extension entry, hooks into response pipeline
├── review-subagent.ts    # subagent spawn logic
├── review-prompt.ts      # subagent system prompt (3-dimension framework)
└── config.ts             # max_cycles, dimension toggles
```

Dependency: `pi-subagents` package.

## Key Decisions

- One subagent per prompt cycle, NOT per tool call (too heavy)
- Subagent at response gate (⑧), NOT inside tool loop (don't interrupt natural flow)
- Read-only reviewer — no tools, no decisions, only flags issues
- Global scope — all Pi conversations, including ralph-loop workers
- `max_review_cycles` default: 2 (configurable)

## Next Steps

1. Invoke `writing-plans` skill
2. Create implementation plan with granular tasks
3. Implement the extension
4. Test with ralph-loop integration

## Spec File

`docs/superpowers/specs/2026-05-22-corrective-review-subagent-design.md`
