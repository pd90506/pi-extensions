---
name: plan-mode
description: Write a structured plan before executing any non-trivial task. Use when no specialized skill matches the task but the task is too complex or ambiguous to dive into without planning first — involves multiple steps, crosses multiple files, requires architecture or API decisions, or could unfold over multiple turns.
---

# Plan Mode

## When This Skill Activates

You are about to start a non-trivial task but found no specialized skill that fits. Instead of diving in, write a structured plan and get user approval first.

## Procedure

1. **Explore** — Perform limited read-only exploration to understand the task context:
   - Read relevant project instructions, README, or docs.
   - Read about 3–5 relevant source files.
   - Run about 2–3 targeted searches or read-only commands.
   - If more exploration is needed, stop and ask before continuing.

2. **Write the plan** — Present an inline plan using this format:

```md
🔍 Plan: <one-sentence intent judgment>

## Plan
1. ...
2. ...
3. ...

## Open questions / assumptions
- ...

## Recommendation
- ...

Please confirm whether I should execute this plan.
```

   Match the language of the conversation. For a Chinese conversation, use Chinese for all plan content.

3. **Wait for approval** — Do not execute until the user clearly approves.

   Strong approval examples: "执行", "按这个做", "开始改", "go ahead", "implement it", "proceed", "approved".

   Not approval: asking why, asking for alternatives, discussing tradeoffs.

   When in doubt, keep discussing. Do not execute.

4. **Execute** — After approval, follow the plan. You may adjust small implementation details, but must stop and ask again for material changes involving:
   - Scope
   - Architecture
   - Public API
   - Data model
   - Dependencies
   - UX behavior
   - Security or risk profile

5. **Mark as approved** — When the user approves, update the plan annotation:

   `✅ Approved: <same intent judgment>`

## What NOT to Plan

- Simple questions — just answer them directly.
- Clear trivial executions (single file, obvious change, no judgment needed) — just do them.
- Tasks where the user already specified a skill — use that skill directly.

These do not need planning.