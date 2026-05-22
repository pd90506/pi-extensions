# Ralph Loop Pi Extension — Design Spec

**Date:** 2026-05-22
**Status:** Approved

## Overview

Adopt the Ralph Wiggum technique (Geoffrey Huntley) as a reusable Pi extension package (`ralph-loop/`). Parent agent orchestrates fresh-context subagents that each complete one bounded iteration, with all state on disk. Two modes: PLANNING (gap analysis → IMPLEMENTATION_PLAN.md) and BUILDING (implement one task per iteration → test → commit → update plan).

## Architecture

```
Parent session (orchestrator, lightweight)
  │
  ├─ /ralph-loop plan "requirements"    → PLANNING mode
  └─ /ralph-loop build "task" [...]     → BUILDING mode (looping)
       │
       └─ [loop] subagent(agent: "ralph-worker", context: "fresh")
            ├─ Read specs/*, IMPLEMENTATION_PLAN.md, .pi/ralph-loop.json
            ├─ PLANNING: gap analysis → write IMPLEMENTATION_PLAN.md
            ├─ BUILDING: pick task → implement → backpressure → commit → update plan
            └─ Write .pi/ralph-result.json {"done": true|false, ...}
```

## Directory Structure

```
ralph-loop/
├── extensions/index.ts            # Pi extension: /ralph-loop, /cancel-ralph
├── skills/SKILL.md                # Teaches agent to be a Ralph worker (loaded via skill injection on subagent)
├── prompts/
│   ├── ralph-plan.md              # PLANNING mode prompt template
│   └── ralph-build.md             # BUILDING mode prompt template
├── templates/ralph-status-schema.json  # Structured output schema for ralph-result.json
├── scripts/cancel.sh              # Clean up state files
└── package.json                   # pi-package manifest
```

## State Files

### .pi/ralph-loop.json (orchestrator state)

```json
{
  "mode": "build",
  "prompt": "Build REST API for todos",
  "completion_promise": "ALL TESTS PASS",
  "max_iterations": 50,
  "iteration": 3,
  "status": "running",
  "session_id": "<pi-session-uuid>"
}
```

### .pi/ralph-result.json (subagent output per iteration)

```json
{
  "done": false,
  "summary": "Implemented GET /todos endpoint. 3 tests passing.",
  "completed_tasks": ["GET /todos"],
  "failed_tasks": [],
  "plan_updated": true,
  "commits": ["abc123"]
}
```

## Data Flow

```
Build loop per iteration:
1. Parent reads .pi/ralph-loop.json → gets iteration, mode, prompt, completion_promise
2. Parent calls subagent({ agent: "ralph-worker", context: "fresh", task: <BUILD_PROMPT> })
   - Subagent inherits ralph-loop skill (injected via skill parameter)
   - Subagent reads specs/*, IMPLEMENTATION_PLAN.md, .pi/ralph-loop.json
   - Picks most important undone task
   - "Don't assume not implemented" — searches codebase first
   - Implements, runs tests (backpressure), commits
   - Updates IMPLEMENTATION_PLAN.md (marks done, notes discoveries)
   - Updates AGENTS.md if new operational learnings
   - Writes .pi/ralph-result.json
3. Parent reads .pi/ralph-result.json
4. If done=true → stop. If iteration >= max_iterations → stop.
   Else → increment iteration in .pi/ralph-loop.json → go to step 2
```

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Loop mechanism | Parent calls subagent() each iteration | Pi has no Stop hook; this aligns with Huntley's "primary context is scheduler" |
| Subagent context | `context: "fresh"` every iteration | Prevents context degradation; state on disk |
| Completion detection | Structured JSON file (`ralph-result.json`) | Reliable, not prone to false match |
| Parent context growth | `outputMode: "file-only"` on subagent calls | Each iteration ~1 short entry, state lives on disk |
| Session isolation | `session_id` in state file | Prevents multi-session interference |
| Skill injection | ralph-loop SKILL.md injected into subagent | Worker gets full methodology without polluting parent context |
| Prompt templates | Separate .md files for plan/build modes | Swappable, user-customizable |

## Files to Create

| File | Purpose |
|------|---------|
| `ralph-loop/package.json` | pi-package manifest |
| `ralph-loop/extensions/index.ts` | `/ralph-loop`, `/cancel-ralph` commands; subagent orchestration |
| `ralph-loop/skills/SKILL.md` | Worker instructions for one Ralph iteration |
| `ralph-loop/prompts/ralph-plan.md` | PLANNING mode prompt |
| `ralph-loop/prompts/ralph-build.md` | BUILDING mode prompt |
| `ralph-loop/templates/ralph-status-schema.json` | JSON schema for `ralph-result.json` |
| `ralph-loop/scripts/cancel.sh` | Remove state files |

And update root `package.json` to include the new extension path.

## Subagent Skill Injection

The parent extension passes `skill: "ralph-loop"` to subagent calls so the worker agent loads the Ralph methodology without it being in the parent's context. Pi-subagents supports `skill` parameter for per-task skill injection. Path resolved from the package's `skills/` directory.
