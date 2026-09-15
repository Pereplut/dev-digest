# DevDigest

Local-first AI pull-request review. Standalone packages with **no workspace**:
run package commands from inside each package dir.
Overview for humans: [README.md](README.md) · Testing strategy: [TESTING.md](TESTING.md)

## Packages
| Dir | Pkg manager | Agent guide | Human docs |
|---|---|---|---|
| `server/` | pnpm | [server/CLAUDE.md](server/CLAUDE.md) | [server/README.md](server/README.md) |
| `client/` | pnpm | [client/CLAUDE.md](client/CLAUDE.md) | [client/README.md](client/README.md) |
| `reviewer-core/` | npm | [reviewer-core/CLAUDE.md](reviewer-core/CLAUDE.md) | [reviewer-core/README.md](reviewer-core/README.md) |
| `e2e/` | npm | [e2e/CLAUDE.md](e2e/CLAUDE.md) | [e2e/README.md](e2e/README.md) |
| `server/src/vendor/shared/` | — | [shared CLAUDE.md](server/src/vendor/shared/CLAUDE.md) | [index.ts header](server/src/vendor/shared/index.ts) |

## Repo-wide rules
- Cross-package code is shared via tsconfig path aliases, not published modules.
- `@devdigest/shared` (Zod contracts) is canonical in `server/src/vendor/shared`;
  `client/src/vendor/shared` is a separate vendored copy — see the shared CLAUDE.md.
- Migrations don't run on boot: after a schema change run `pnpm db:generate` + `pnpm db:migrate` in `server/`.
- Dev stack: `./scripts/dev.sh`. Never `docker compose down -v` — it wipes the dev DB volume.

## Where things go
Every package (and the root) has the same layout:
- `README.md` — for humans: what it is, how to run it, architecture.
- `CLAUDE.md` — for agents: commands, boundaries, conventions, pointers.
- `docs/` — how things **are**: deep dives, ADRs (`docs/adr/NNNN-title.md`).
- `specs/` — how things **will be**: one spec per feature (format in [specs/README.md](specs/README.md)).
- `INSIGHTS.md` — append-only log of non-obvious gotchas.

A feature spanning several packages gets its spec in root `specs/`; a single-package one in `<pkg>/specs/`.

## Workflow
1. Before implementing, check `specs/` and `<pkg>/specs/` for an existing spec.
2. Before editing a package, read its `INSIGHTS.md` (and [INSIGHTS.md](INSIGHTS.md) for cross-package ones).
   Treat entries as high-confidence guidance unless the code now says otherwise.
3. During work: when a non-obvious dependency, fix, measured fact, odd finding, tool quirk,
   or LLM/review-engine behavior is confirmed, record it with the
   [`engineering-insights`](.claude/skills/engineering-insights/SKILL.md) skill
   (dated, with `file:line` evidence, in the INSIGHTS.md of the module you worked in).
4. After finishing: update the spec `status`, move durable explanations into `docs/`,
   and after every code task run `engineering-insights` as a wrap-up.
   A `UserPromptSubmit` hook (`.claude/hooks/insights-session-start.py`) automates the loop on each
   session's first request: a wrap-up of the previous session if it edited files without one,
   then the INSIGHTS read. INSIGHTS.md is edited only when there's news.
