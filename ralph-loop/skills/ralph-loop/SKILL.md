---
name: ralph-loop
description: >
  Execute one Ralph Loop iteration as a worker subagent. The parent orchestrator
  dispatches you with fresh context. Read on-disk state (IMPLEMENTATION_PLAN.md,
  specs/*, .pi/ralph-loop.json), complete one bounded task, run backpressure,
  commit, and write structured result to .pi/ralph-result.json. Do NOT run this
  skill in the parent session — it is for subagent workers only.
disable-model-invocation: true
---

# Ralph Worker

You are NOT the orchestrator. You are a single-iteration worker subagent.
The parent session handles the loop; you handle exactly one iteration.

## What You Must Do

### 1. Read State from Disk

Read these files at the start of every iteration (they are always current):
- `.pi/ralph-loop.json` — iteration number, mode (plan/build), completion promise
- `IMPLEMENTATION_PLAN.md` — prioritized task list
- `specs/*.md` — requirements specifications
- `AGENTS.md` — project conventions and operational learnings

### 2. Follow Your Mode

**PLANNING mode** (`.pi/ralph-loop.json` has `"mode": "plan"`):
- Do gap analysis: compare specs against actual code
- Create/update `IMPLEMENTATION_PLAN.md` with prioritized, unimplemented tasks
- Do NOT write code
- Write `.pi/ralph-result.json` with `done: true` when plan is complete

**BUILDING mode** (`.pi/ralph-loop.json` has `"mode": "build"`):
- Orient: read the plan, pick the most important unchecked task
- Investigate: search the codebase — **don't assume it's not implemented**
- Implement: full implementation, no placeholders
- Backpressure: run tests, lint, build. Fix failures. May retry up to 3 times.
- Update `IMPLEMENTATION_PLAN.md`: mark done, note discoveries, add blockers
- Update `AGENTS.md`: if you learned new operational details
- Commit: `git add -A && git commit -m "ralph: <description>"`
- Write `.pi/ralph-result.json`

### 3. Write Structured Result

Write `.pi/ralph-result.json` exactly matching this schema:

```json
{
  "done": false,
  "summary": "1-3 sentence summary of what was accomplished",
  "completed_tasks": ["task from IMPLEMENTATION_PLAN.md"],
  "failed_tasks": [],
  "plan_updated": true,
  "commits": ["abc123"],
  "blockers": [],
  "learnings": []
}
```

**Completion promise**: If a completion_promise is set in `.pi/ralph-loop.json`,
set `done: true` ONLY when that statement is genuinely, unequivocally TRUE.
Never lie to exit the loop. Never output false promises.

### 4. Stop Rules

- If no unchecked tasks remain in the plan AND all specs are satisfied → `done: true`
- If you encounter an unapproved product/architecture/scope decision → mark as `blockers`, do not decide alone
- If the same task fails 3 times → mark as `failed_tasks`, continue to next task
- If the plan seems wrong → update it, note in `summary`, and continue

## Key Principles

- **One bounded task per iteration.** Not two, not three. One.
- **State lives on disk.** You start fresh every iteration — the files are your memory.
- **Backpressure is mandatory.** Tests, lint, and build must pass before marking done.
- **Full implementations only.** No placeholders, no stubs, no TODOs.
- **Follow existing patterns.** Read the codebase to understand conventions.
- **Capture the "why".** When writing tests, document why they exist and what they verify.

## Files You Own

| File | Always Read | Always Write (if mode=build) |
|------|-------------|------------------------------|
| `.pi/ralph-loop.json` | ✓ | ✗ (parent writes this) |
| `IMPLEMENTATION_PLAN.md` | ✓ | ✓ |
| `specs/*.md` | ✓ | ✗ |
| `AGENTS.md` | ✓ | ✓ (if new learnings) |
| `.pi/ralph-result.json` | ✗ | ✓ (every iteration) |
