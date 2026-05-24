# pi-extensions — Agent Instructions

## Repository shape

- This top-level checkout is a single Git repository containing Pi-related extensions/packages.
- The Superpowers project lives in `superpowers/` as a normal tracked subdirectory, not a nested Git repository.
- When changing files under `superpowers/`, follow the additional project instructions in `superpowers/AGENTS.md`.
- Pi only auto-loads context files from the current directory and its parents, so this root file exists to point agents at the `superpowers/` project context when starting from the repo root.

## Primary project: `superpowers/`

Superpowers is a software-development methodology packaged as agent skills and harness integrations. It includes:

- `skills/` — skill definitions and supporting references.
- `hooks/` — hook files for supported harnesses.
- `.claude-plugin/`, `.codex-plugin/`, `.cursor-plugin/`, `.opencode/` — harness-specific packaging/integration files.
- `docs/` — design/implementation notes and harness docs.
- `tests/` — shell and Node-based tests for skill triggering, harness integrations, and support utilities.

Before making substantive changes in `superpowers/`, read:

1. `superpowers/AGENTS.md` — strict contributor and PR rules.
2. `superpowers/README.md` — project overview, installation, workflow, and contribution summary.
3. Relevant skill docs under `superpowers/skills/<skill>/SKILL.md` for any skill you modify.
4. Relevant test/docs files for the affected harness or feature.

## Non-negotiable contribution rules

The `superpowers/AGENTS.md` file is authoritative for changes under `superpowers/`. In particular:

- Do not open PRs without reading and fully satisfying `superpowers/.github/PULL_REQUEST_TEMPLATE.md`.
- Search existing open and closed PRs before proposing upstream contributions.
- Verify the change solves a real experienced problem; avoid speculative or bulk changes.
- Keep changes focused to one problem.
- Do not add third-party dependencies unless adding support for a new harness.
- Do not rewrite skill wording or structure for style/compliance reasons without evaluation evidence.
- Domain-specific or personal workflow features belong in separate plugins, not Superpowers core.

## Development guidance

- For skill changes, use the repository’s own `writing-skills` process and include before/after evaluation evidence where behavior changes.
- Preserve deliberately tuned language in skills unless there is evidence that a change improves agent behavior.
- For new harness support, prove end-to-end skill loading with the acceptance prompt from `superpowers/AGENTS.md`:
  `Let's make a react todo list` must auto-trigger `brainstorming` before code is written.
- Keep docs, tests, and release notes aligned when behavior changes.
- Prefer minimal, evidence-backed changes over broad refactors.

## Useful commands

From the top-level directory:

```bash
# Inspect repository state
git status --short

# Install the local Superpowers package into Pi for testing
pi install ./superpowers
```

From `superpowers/`:

```bash
# Brainstorm server tests
cd tests/brainstorm-server
npm test

# OpenCode structure/cache tests; add --integration only when OpenCode is available
cd ../..
tests/opencode/run-tests.sh

# Explicit skill request tests; may require the target agent harness/configuration
tests/explicit-skill-requests/run-all.sh

# Claude Code integration tests; require Claude Code and local dev marketplace setup
tests/claude-code/test-subagent-driven-development-integration.sh
```

## Testing notes

- Some tests invoke real agent harnesses and can be slow or require local credentials/configuration.
- `superpowers/docs/testing.md` explains Claude Code integration test requirements and transcript-based verification.
- For harness-specific work, run the closest fast structural tests first, then run integration tests when the required harness is available.

## Working with Pi

- Pi loads `AGENTS.md` and `CLAUDE.md` from the current directory and parents at startup.
- If you start Pi from the top-level checkout, this file is loaded; if you `cd superpowers`, `superpowers/AGENTS.md` is also loaded.
- Project-level Pi customizations can live under `.pi/`, but avoid adding local-only workflow files unless explicitly requested.
