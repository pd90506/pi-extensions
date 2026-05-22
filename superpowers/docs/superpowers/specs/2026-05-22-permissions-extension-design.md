# Permissions Extension — Design Spec

## Overview

A multi-level permission gate extension for Pi, modeled after Claude Code's permission
levels. Intercepts all tool calls and applies configurable allow/block/prompt rules based
on the active permission level. Provides a `/permissions` command, `Shift+Tab` shortcut
for level cycling, and a `set_permissions` custom tool for LLM-initiated level changes.

## Permission Levels

All levels inherit the Plan Mode baseline (read tools always auto-allowed).

| Level | Name            | Behavior |
|-------|-----------------|----------|
| 1     | Ask Permissions | Prompt for all writes, bash, and unknown tools |
| 2     | Accept Edits    | Auto-allow edit/write within cwd; prompt for bash and external paths |
| 3     | Plan Mode       | Block all writes and bash; read-only |
| 4     | Auto Mode       | Subagent classifies each bash command by risk; auto-allows all other tools |
| 5     | Bypass          | All tools auto-allowed; requires double-confirm on activation |

### Shared Baseline (all levels)

- `read` — auto-allow
- `web_search`, `fetch_content`, `code_search` — auto-allow

### Level 1: Ask Permissions

- Baseline +
- `edit`, `write` — always prompt
- `bash` — always prompt
- `subagent` and other tools — prompt

### Level 2: Accept Edits

- Baseline +
- `edit`, `write` — auto-allow if path is inside `cwd`; prompt otherwise
- `bash` — always prompt
- Other tools — prompt

### Level 3: Plan Mode (Read-Only)

- Baseline only
- `edit`, `write`, `bash` — always block with reason "Plan mode active"

### Level 4: Auto Mode

- Baseline +
- `edit`, `write`, `web_search`, `fetch_content`, `code_search` — auto-allow
- `bash` — dispatch subagent classifier; auto-allow low-risk, prompt medium/high risk
- Other tools — auto-allow

### Level 5: Bypass Permissions

- All tools auto-allowed
- Double-confirm gate on activation
- Warning widget while active (persistent until level is changed)

## Implementation Structure

```
extensions/permissions/
    index.ts          # Entry point: hooks, commands, shortcuts
    classifier.ts     # Subagent dispatch for bash risk classification
    sensitive-files.ts # Default sensitive file patterns + matching
```

## Architecture

```
User submits prompt → LLM calls tool
  → tool_call event fires
    → Extension checks level
      → Level 1: prompt per rules
      → Level 2: auto-allow edits in cwd, prompt for bash
      → Level 3: block writes + bash
      → Level 4: subagent classifies bash; auto-allow rest
      → Level 5: allow all (after double-confirm gate)
```

## Key APIs

- `pi.on("tool_call")` — intercept tool invocations
- `pi.on("session_start")` — restore state from session
- `pi.registerCommand("/permissions")` — user level control
- `pi.registerShortcut("shift+tab")` — cycle levels via select dialog
- `pi.registerTool("set_permissions")` — LLM-requested level changes
- `pi.appendEntry("permissions-level", ...)` — persist current level
- `ctx.ui.select/confirm/notify` — user interaction
- `ctx.ui.setStatus/setWidget` — footer status and warning widget
- `subagent` (via pi-subagents) — bash risk classification

## Subagent Classifier (Level 4)

Dispatched per bash command in Auto Mode.

### Input
- Bash command string
- Working directory (`cwd`)

### Output
```json
{ "risk": "low" | "medium" | "high", "reason": "..." }
```

### Classification Guidelines
- **Low risk** — safe/read-only: `ls`, `cat`, `echo`, `grep`, `find`, `git status/diff/log`,
  `npm test`, `cargo build`, standard build commands
- **Medium risk** — potentially destructive but recoverable: `git commit/push`,
  `npm install`, `pip install`, file moves/renames, `docker` commands
- **High risk** — destructive: `rm -rf`, `sudo`, `curl | bash`, `chmod 777`,
  `git push --force`, database drops, `kill`, `shutdown`

### Performance
- Each bash command is classified independently (parallel bash calls dispatch
  parallel subagents)

### Fallback
- If subagent is unavailable, fall back to prompting the user (treat as medium/high risk)

## Toggling

- **`/permissions`** — shows current level + description
- **`/permissions 1`..`/permissions 5`** — sets level directly
- **`Shift+Tab`** — opens select dialog cycling through all levels
- **`set_permissions` tool** — LLM requests level change; user is prompted to confirm

## UI Feedback

- Footer status: `🔒 Ask` | `✏️ AcceptEdits` | `📋 Plan` | `🤖 Auto` | `⚡ Bypass`
- Level 5 uses a distinct warning color
- When Level 5 is active, show a persistent warning widget above the editor

## State Persistence

Level stored as `appendEntry("permissions-level", { level: <number> })` on each change.
Restored on `session_start` by scanning for the latest such entry.

## Error Handling & Edge Cases

| Scenario | Behavior |
|----------|----------|
| Non-interactive mode (`hasUI === false`) | Block all prompts (fail-safe) |
| Subagent unavailable for classifier | Fall back to user prompt |
| Unknown/unregistered tools | Prompt (levels 1-3), auto-allow (levels 4-5) |
| Path outside cwd at level 2 | Prompt with path displayed |
| Double-confirm cancelled at level 5 | Stay at current level |
| Subagent dispatch from classifier | Bypass permission checks (avoid infinite recursion) |

## Testing

- Unit tests for rule matching per level
- Integration tests: spawn Pi with the extension, verify tool_call interception
  behavior at each level
