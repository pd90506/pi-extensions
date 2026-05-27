# pi-extensions

Personal Pi package for loading Superpowers in Pi.

## Included

- `extensions/superpowers-bootstrap.ts` — Pi compatibility/bootstrap extension for Superpowers.
- `superpowers/skills` — Superpowers skill library.
- `superpowers/` — Superpowers package and docs, tracked as a Git subtree from upstream.

## Install

From this repo:

```bash
pi install .
```

Or by absolute path:

```bash
pi install /Users/panda/repo/pi-extensions
```

Restart Pi after installing so the package reloads.

## Package manifest

The root `package.json` exposes:

```json
{
  "pi": {
    "extensions": ["./extensions/superpowers-bootstrap.ts"],
    "skills": ["./superpowers/skills"]
  }
}
```

## Upstream Superpowers

See `superpowers/README.md` for upstream Superpowers docs, supported harnesses, workflow, and contribution notes.

## Superpowers subtree

`superpowers/` is tracked as a Git subtree, not a submodule. Plain clones include all files, so `pi install .` works without extra submodule setup.

- Parent repo branch for this package: `dev`
- Upstream remote: `superpowers-upstream`
- Upstream URL: `https://github.com/obra/superpowers.git`
- Upstream branch: `main`
- Initial subtree import used upstream commit `f2cbfbe`

If the upstream remote is missing, add it:

```bash
git remote add superpowers-upstream https://github.com/obra/superpowers.git
```

Update Superpowers from upstream:

```bash
git switch dev
git fetch superpowers-upstream main
git subtree pull --prefix=superpowers superpowers-upstream main --squash
```

Use `--squash` so upstream changes land as one clean commit in this repo instead of importing full upstream history.
