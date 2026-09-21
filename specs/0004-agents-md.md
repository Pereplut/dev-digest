---
title: AGENTS.md as the canonical agent doc
status: done  # draft | approved | in-progress | done
packages: [all]
---

## Problem
Agent instructions lived in six `CLAUDE.md` files (root + `server/`, `client/`,
`reviewer-core/`, `e2e/`, `server/src/vendor/shared/`). That filename is specific to
Claude Code, so every other coding agent (Codex, Cursor, Jules, Aider, …) ignored them.
We want one set of instructions that any tool can read, without losing Claude Code support.

Constraint, verified against `code.claude.com/docs/en/memory.md`:
- Claude Code reads **only** `CLAUDE.md`. There is no settings key, env var or fallback for `AGENTS.md`.
- The documented workarounds are a `CLAUDE.md` that imports the file (`@AGENTS.md`) or a symlink.
- `@path` imports resolve relative to the importing file, recurse up to 4 hops, and are expanded
  when that `CLAUDE.md` loads — including the nested ones Claude loads lazily on touching a directory.

## Scope / non-goals
- **In scope:** renaming all six files, the `CLAUDE.md` import stubs, cross-link fixes,
  a drift check in CI, and a README note.
- **Non-goals:** `.cursor/rules/` and `.github/copilot-instructions.md` pointers (can follow later);
  rewriting the instructions themselves; `.claude/skills/zod/AGENTS.md` (a skill's compiled guide, unrelated).

## Design
Content moves to `AGENTS.md`; each `CLAUDE.md` becomes a pointer:

```markdown
# <name> — agent instructions

Canonical instructions live in AGENTS.md (the cross-tool convention). Edit that file, not this one.

@AGENTS.md
```

**Import stub, not symlink** — it survives Windows checkouts (symlinks need Developer Mode),
renders readably on GitHub, and leaves room for Claude-only notes later. The import must be bare:
a backticked `` `@AGENTS.md` `` is literal text and is not imported.

`scripts/check-agent-docs.sh` walks `git ls-files` and asserts every tracked `AGENTS.md` has a
sibling `CLAUDE.md` containing a bare `@AGENTS.md` line, and that no `CLAUDE.md` is orphaned.
`.github/workflows/agent-docs.yml` runs it on any change to those paths.

Note: Claude Code's `#` memory shortcut appends to `CLAUDE.md`; anything it adds should be
moved into the sibling `AGENTS.md`.

## Acceptance criteria
- Six `AGENTS.md` files carry the full instructions; six `CLAUDE.md` stubs import them.
- No link in an `AGENTS.md`, `README.md` or config comment points at a stub as if it held content.
- `bash scripts/check-agent-docs.sh` exits 0 and lists six pairs; CI runs it.
- A fresh Claude Code session still loads the root instructions and the nested ones on demand.
- Renames keep history (`git mv`, shown as `R` in `git status`).

## Test plan
1. `bash scripts/check-agent-docs.sh` → exit 0, six `ok:` lines.
2. `grep -rn "CLAUDE\.md"` → only the stubs, this spec, the README note, and historical INSIGHTS entries.
3. Fresh Claude Code session: `/memory` lists the root `CLAUDE.md` and its `@AGENTS.md` import;
   after touching a file in `client/`, a question answerable only from `client/AGENTS.md` succeeds.
4. Open the repo in another tool (Codex/Cursor) and confirm `AGENTS.md` is picked up.
5. `(cd server && pnpm lint)` — `eslint.config.mjs` changed (comment only).

## Phases
| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-09-18 | Request read; INSIGHTS + specs checked; confirmed Claude Code has no AGENTS.md support |
| Planning | 2026-09-18 | Import stub over symlink; all 6 locations; drift check + spec + README note agreed |
| Implementation | 2026-09-18 | `git mv` ×6, stubs ×6, cross-links, `scripts/check-agent-docs.sh`, `agent-docs.yml`, README |
| Validation | 2026-09-18 | check script 6/6 · grep sweep clean · server lint at baseline (0 errors, 6 known warnings) · `claude -p` in a fresh session answered from AGENTS.md content through the stub |
| Completion | 2026-09-18 | status done; insights wrap-up recorded in root/server/client/e2e INSIGHTS.md |
