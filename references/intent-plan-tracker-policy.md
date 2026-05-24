# Intent Plan Tracker Policy

Detailed tracker policy for the `intent-plan-discipline` Pi extension.

Read this file only after all of these are true:

1. The request was Tier 3.
2. The user approved execution.
3. The approved task is complex enough to need a persistent tracker.

Do not read this file for Tier 1 questions, Tier 2 trivial execution requests, or unapproved Tier 3 planning.

---

## Persistent Plan Trackers for Complex Tasks

Before approval, default to inline plans only.

After approval, if the task is complex, automatically create a persistent plan tracker under:

```text
.pi/plans/<intent-slug>.md
```

Use an intention-based slug, for example:

```text
.pi/plans/intent-and-plan-policy.md
.pi/plans/refactor-auth-flow.md
.pi/plans/add-extension-permission-gates.md
```

## Complex Task Threshold

A task is complex if it satisfies any two or more of these:

- More than 3 execution steps.
- Crosses more than 3 files or more than 2 modules.
- Requires tests plus docs/config updates.
- Involves architecture, public API, data model, dependency choice, or UX behavior.
- Likely spans more than one agent turn.
- Has explicit stop conditions or multiple uncertainty points.
- User explicitly asks to track, not forget, or follow a plan.

## Tracker Purpose

The tracker is private agent working memory by default, not formal project documentation.
It prevents plan drift and preserves execution state.

A tracker should contain:

```md
# Plan: <intent>

## Intent
What the user wants, including whether the request was question, command, or ambiguous command.

## Approved Scope
What the user approved.

## Non-goals
What not to do.

## Plan
1. ...
2. ...

## TODO
- [ ] ...
- [ ] ...

## Stop Conditions
Stop and ask the user if any of these occur.

## Notes / Deviations
Important discoveries, test results, or approved changes to the plan.
```

## Updating the Tracker

When a tracker exists:

- Update TODO checkboxes as work completes.
- Record important deviations or discoveries.
- Update notes when tests fail/pass in ways that affect the plan.
- If the approved scope changes, update the tracker after user confirmation.

## Formal Documentation

Do not treat `.pi/plans/` as formal project docs by default. If the user asks, extract or convert the tracker into official docs, ADRs, issue comments, PR summaries, or changelog entries.

## Resuming Previous Work

Only when the user expresses a resume intent — for example “continue”, “resume”, “接着”, “继续”, “上次”, “那个任务” — check `.pi/plans/` for a relevant tracker and use it to restore context.

Do not read `.pi/plans/` on every task by default.
