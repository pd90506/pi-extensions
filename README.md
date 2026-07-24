# pi-kit

Personal pi package: extensions, skills, subagents, and custom agents.

> Previous contents of this repo (Superpowers integration) are preserved on
> branch `backup/superpowers-main`.

## Structure

```
├── package.json            # pi package manifest
├── extensions/
│   ├── subagent/           # Subagent tool: delegate tasks to isolated pi processes
│   │   ├── index.ts        #   (single / parallel / chain modes, vendored from pi examples)
│   │   └── agents.ts       #   agent discovery (~/.pi/agent/agents + .pi/agents)
│   └── sync-agents.ts      # Copies agents/*.md → ~/.pi/agent/agents on session start
├── agents/                 # Custom agent definitions shipped with this package
│   ├── scout.md            #   Fast codebase recon (restricted tools)
│   ├── planner.md          #   Implementation planning
│   ├── reviewer.md         #   Code review
│   └── worker.md           #   General-purpose (full capabilities)
├── skills/
│   └── example-skill/      # Template skill — replace with your own
└── prompts/                # Workflow prompt templates (/implement etc.)
    ├── implement.md        #   scout → planner → worker
    ├── scout-and-plan.md   #   scout → planner
    └── implement-and-review.md  # worker → reviewer → worker
```

## Install

```bash
pi install .
# or by absolute path
pi install /Users/panda/Documents/Projects/pi-extensions
```

Restart pi after installing. On first session start, `sync-agents` copies the
agent definitions into `~/.pi/agent/agents/` (existing files are never
overwritten).

## Usage

### Subagents

```
Use scout to find all authentication code
Run 2 scouts in parallel: one to find models, one to find providers
Use a chain: first scout finds the read tool, then planner suggests improvements
```

### Workflow prompts

```
/implement add Redis caching to the session store
/scout-and-plan refactor auth to support OAuth
/implement-and-review add input validation to API endpoints
```

### Skills

Skills load on demand when the model judges them relevant, or force-load with
`/skill:example-skill`.

## Adding your own

| What | Where | Notes |
|------|-------|-------|
| Extension | `extensions/*.ts` or `extensions/<dir>/index.ts` | Add path to `pi.extensions` in `package.json` |
| Custom agent | `agents/<name>.md` | YAML frontmatter: `name`, `description`, optional `tools`, `model` |
| Skill | `skills/<name>/SKILL.md` | Auto-discovered |
| Prompt template | `prompts/<name>.md` | Invoked as `/<name>` |

See pi docs: `docs/packages.md`, `docs/extensions.md`, `docs/skills.md` in the
pi installation.
