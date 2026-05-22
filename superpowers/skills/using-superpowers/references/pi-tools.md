# Pi Tool Mapping

Skills use Claude Code tool names. When you encounter these in a skill, use your Pi equivalent:

| Skill references | Pi equivalent |
|-----------------|---------------|
| `Skill` tool (invoke a skill) | `read` to load `skills/<skill-name>/SKILL.md`, or `/skill:name` |
| `Task` tool (dispatch subagent) | `subagent` (requires `pi-subagents` package: `pi install npm:pi-subagents`) |
| `Read` (file reading) | `read` |
| `Write` (file creation) | `write` |
| `Edit` (file editing) | `edit` |
| `Bash` (run commands) | `bash` |
| `Grep` (search file content) | `bash` with `grep` or `rg` |
| `Glob` (search files by name) | `bash` with `ls`, `find` |
| `WebSearch` | `web_search` |
| `WebFetch` | `fetch_content` |
| `TodoWrite` (task tracking) | No direct equivalent. Use `write` to create a task tracking file, or maintain a mental checklist. |

## Skill Discovery

Pi discovers skills automatically from skill directories (see Pi's docs/skills.md for locations). Skill descriptions are included in the system prompt at startup — the agent sees available skills and invokes them via `read` when relevant. No manual tool invocation is needed for discovery.

## Subagent Support

Pi supports subagents via the `subagent` tool, provided by the `pi-subagents` package. Install it:

```bash
pi install npm:pi-subagents
```

The `subagent` tool supports single-agent dispatch, parallel dispatch, and chained workflows.

When a skill says to "dispatch a subagent," use `subagent` with the agent type and task. When a skill says to dispatch multiple subagents in parallel, use the parallel mode of the `subagent` tool.

## Additional Pi Tools

These tools are available in Pi but have no direct Claude Code equivalent:

| Tool | Purpose |
|------|---------|
| `code_search` | Search for code examples and API documentation |
| `get_search_content` | Retrieve full content from prior web_search or fetch_content calls |
| `analyze_image` | Targeted image analysis with crop and grounding support |
