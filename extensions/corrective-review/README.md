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
# Unit tests — verdict parser (20 cases)
npx tsx extensions/corrective-review/__tests__/review-prompt.test.ts

# Unit tests — collector (6 cases)
npx tsx extensions/corrective-review/__tests__/collector-agent-end.test.ts

# Smoke test (requires interactive Pi session)
# See __tests__/smoke-test.md
```

## Design Decisions

- **Subprocess, not subagent** — The review runs as `pi -p` (print mode), not as a subagent. The extension parses the verdict directly without relying on the agent to call a subagent tool.
- **message_end, not agent_end** — Intercepts at message_end (before rendering), so FAIL verdicts replace the message before the user sees it.
- **Inline collection** — Tool results are collected as they happen via `tool_result` events, avoiding the need to scan all messages at the end.
- **Read-only reviewer** — The subprocess has no tools. It only evaluates the evidence.
- **Fail-closed** — If the subprocess crashes, times out, or returns garbled output, the review is silently skipped and the response passes through.
