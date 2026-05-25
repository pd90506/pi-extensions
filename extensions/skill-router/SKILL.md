---
name: skill-router
description: Routes non-trivial tasks to the most appropriate loaded skill. Use when a task involves ambiguity, multiple implementation paths, cross-module changes, architecture/API/data-model decisions, or unfolds over multiple turns — any task where starting work immediately without a structured approach risks wasted effort.
---

# Skill Router

<HARD-GATE>
Before starting ANY work on a task that triggered this skill, you MUST follow the routing procedure below. Skipping this and diving into work directly is ALWAYS the wrong choice — even if the task seems simple, even if you think you already know what to do, even if you feel productive starting immediately. Stop. Route first.
</HARD-GATE>

## When This Skill Activates

You identified a task that needs a structured approach. Instead of starting work immediately, route to the most appropriate skill.

## Routing Procedure

1. **Scan available skills** — Read the descriptions of all skills listed in `<available_skills>` in the system prompt. Identify which skill best matches the task.

2. **Announce** — Start your response with a routing annotation:

   `🔄 Routing to: <skill-name> — <one-sentence task summary>`

   Match the language of the conversation. For a Chinese conversation:
   `🔄 路由到：<skill-name> — <一句话任务总结>`

3. **Load the skill** — Invoke the identified skill immediately. Follow its instructions from that point on.

4. **No matching skill found** — Default to **plan-mode**. Announce:

   `🔄 Routing to: plan-mode — <task summary> — no specialized skill found`

5. **Not even plan-mode available** — Stop and tell the user no matching skill was found. Ask how they'd like to proceed. Do NOT start working on the task.

## How to Choose a Skill

Read each available skill's description carefully. Pick the one whose capability best matches the task's nature — not the first one that sounds vaguely related. When in doubt between two skills, prefer the one that provides more structure.

Common task patterns and the skill types they usually match (these are hints, not a fixed table — always check actual available skills):

| Task pattern | Skill type to look for |
|---|---|
| New feature or behavior change | Planning, TDD |
| Bug or regression | Debugging, diagnosis |
| Architecture improvement | Planning, codebase improvement |
| Design exploration | Brainstorming, prototyping |
| Writing a new skill | Skill creation |

If multiple skills could apply, pick the one that addresses the most fundamental concern first (e.g., brainstorming before planning, diagnosis before debugging).

## Red Flags — Stop and Route Instead

These thoughts mean you are about to skip routing:

| Thought | Reality |
|---|---|
| "This is simple enough, I don't need a skill" | Simple tasks become complex. Route. |
| "I already know what to do" | Knowing the goal ≠ knowing the best process. Route. |
| "The skill would slow me down" | Skipping structure wastes more time than using it. |
| "Let me explore the code first, then route" | Route NOW. The skill will tell you how to explore. |
| "I'll just make this one quick change" | One change leads to ten. Route first. |

## What NOT to Route

- Simple questions — just answer them directly.
- Clear trivial executions — just do them.
- Tasks where the user already specified a skill — use that skill directly.

These are not routing failures — they mean no skill is needed.