# DevDigest

Local-first AI pull-request review. Standalone packages with **no workspace**:
run package commands from inside each package dir.
Overview for humans: [README.md](README.md) · Testing strategy: [TESTING.md](TESTING.md)

## Tech stack
All packages are TypeScript on Node ≥ 22.

| Package | Framework / runtime | Key libraries | Tests |
|---|---|---|---|
| `server/` | Fastify 5 (`tsx watch`) | Drizzle ORM + drizzle-kit, Postgres 16 + pgvector (`postgres`), Zod + fastify-type-provider-zod, openai / @anthropic-ai/sdk, octokit, simple-git, @ast-grep/napi, js-tiktoken, p-queue | vitest, testcontainers |
| `client/` | Next.js 15 (App Router), React 19 | TanStack Query, next-intl, Zod, Tailwind CSS 4, recharts, mermaid, react-markdown, lucide-react | vitest + React Testing Library (jsdom) |
| `reviewer-core/` | plain TS library (consumed as source) | Zod, openai SDK (OpenRouter-compatible) | vitest |
| `e2e/` | tsx runner (`run.ts`) | agent-browser CLI (Chrome for Testing) | JSON flows |
| `server/src/vendor/shared/` | — | Zod contracts (`@devdigest/shared`) | via server tests |

## Packages
| Dir | Role | Port | Pkg manager | Agent guide | Human docs |
|---|---|---|---|---|---|
| `server/` | `@devdigest/api`: REST API, DB schema and migrations, GitHub/git/LLM adapters, review run executor, repo-intel indexer | 3001 | pnpm | [server/AGENTS.md](server/AGENTS.md) | [server/README.md](server/README.md) |
| `client/` | `@devdigest/web`: the studio UI (PR list, PR detail, findings, agents, settings) | 3000 | pnpm | [client/AGENTS.md](client/AGENTS.md) | [client/README.md](client/README.md) |
| `reviewer-core/` | `@devdigest/reviewer-core`: pure review engine (diff → prompt → LLM → grounded findings, cost sum) | — | npm | [reviewer-core/AGENTS.md](reviewer-core/AGENTS.md) | [reviewer-core/README.md](reviewer-core/README.md) |
| `e2e/` | `@devdigest/e2e`: deterministic browser flows over the seeded stack | — | npm | [e2e/AGENTS.md](e2e/AGENTS.md) | [e2e/README.md](e2e/README.md) |
| `server/src/vendor/shared/` | `@devdigest/shared`: canonical Zod contracts (client keeps a vendored copy) | — | — | [shared AGENTS.md](server/src/vendor/shared/AGENTS.md) | [index.ts header](server/src/vendor/shared/index.ts) |

Also at the root:
- `scripts/`: `dev.sh`, `e2e.sh`, `check-agent-docs.sh`, `check-claude-skills.sh`, `git-hooks/pre-push` (opt-in PR gate)
- `.github/workflows/`: one CI workflow per suite
- `.claude/`: skills, the insights hook and the pr-self-review gate
- `docs/`, `specs/`: cross-package docs and specs

## Run
- **Whole stack:** `./scripts/dev.sh`. It starts Postgres in Docker, creates `.env` files, installs, migrates, seeds, and runs the API on :3001 and the web app on :3000. Flags: `--no-seed`, `--no-client`, `--db-only`.
- **Manual:**
  1. `docker compose up -d`
  2. `cd server && pnpm install && pnpm db:migrate && pnpm db:seed && pnpm dev`
  3. `cd client && pnpm install && pnpm dev`
- **Hermetic e2e stack** (throwaway Postgres, API and web): `./scripts/e2e.sh`

## Verify
| Package | Typecheck | Lint | Tests |
|---|---|---|---|
| `server/` | `pnpm typecheck` | `pnpm lint` | unit: `pnpm exec vitest run --exclude '**/*.it.test.ts'` · integration (Docker): `pnpm exec vitest run .it.test` |
| `client/` | `pnpm typecheck` | `pnpm lint` | `pnpm test` |
| `reviewer-core/` | `npm run typecheck` | `npm run lint` | `npm test` |
| `e2e/` | `npm run typecheck` | `npm run lint` | `./scripts/e2e.sh` (from the root) |

A change to `reviewer-core/` or `server/src/vendor/shared/` also requires server typecheck and tests.

## Naming conventions
- **Server:**
  - A feature module lives in `src/modules/<name>/` with `routes.ts`, `service.ts` and `repository/<entity>.repo.ts`.
  - Schema tables are in `src/db/schema/<area>.ts`.
- **Client:**
  - Routes follow `src/app/**/page.tsx`.
  - Feature components go in `_components/<PascalCase>/<PascalCase>.tsx`, next to `<PascalCase>.test.tsx`, `styles.ts`, `helpers.ts` and `constants.ts`.
  - Shared components go in `src/components/<kebab-case>/` with an `index.ts` barrel.
  - Hooks are `useXxx` in `src/lib/hooks/<domain>.ts`.
- **i18n:** `client/messages/en/<camelCaseNamespace>.json`, with camelCase keys (`finding.accept`, `list.columns.cost`).
- **TypeScript:**
  - camelCase for variables and functions; PascalCase for components, types and Zod schemas.
  - A schema and its `z.infer` type share one name (`export const PrMeta` / `export type PrMeta`).
- **Data:**
  - DB tables and columns are snake_case (`agent_runs.cost_usd`); Drizzle properties are camelCase (`costUsd`).
  - API and contract JSON fields are snake_case (`cost_usd`, `findings_counts`).
  - Severities are uppercase strings (`CRITICAL`, `WARNING`, `SUGGESTION`).
- **Files:**
  - Tests: `*.test.ts(x)`. DB-backed server tests: `*.it.test.ts`.
  - Migrations: `NNNN_<drizzle-generated-name>.sql`.
  - e2e flows: `NN-name.flow.json`.
  - Specs and ADRs: `NNNN-short-name.md`.

## Do not touch
- **Migrations:** `server/src/db/migrations/**` (the `.sql` files and `meta/` snapshots).
  - Never hand-edit, rename, reorder or delete an existing migration.
  - A schema change goes in `server/src/db/schema/`. Then run `pnpm db:generate` (creates the next migration) and `pnpm db:migrate`.
- **Lockfiles:** `server/pnpm-lock.yaml`, `client/pnpm-lock.yaml`, `reviewer-core/package-lock.json`, `e2e/package-lock.json`, `skills-lock.json`.
  - Never hand-edit, regenerate from scratch, or delete them.
  - They change only as a side effect of that package's own manager (`pnpm add` / `npm i`) when dependencies change.
  - Never add a second lockfile (for example `package-lock.json` in a pnpm package).
- **Vendored code:** `client/src/vendor/ui` (ported UI kit). Contracts only change together with the shared AGENTS.md rules.
  - Single exception: `client/src/vendor/ui/nav.ts` (the sidebar nav and shortcut registry) may change when a new top-level page ships (spec 0006). `review_scope.py` allows exactly this file.
- **Dev DB volume:** never run `docker compose down -v`; it wipes the dev DB volume.

## Repo-wide rules
- Cross-package code is shared via tsconfig path aliases, not published modules.
- `@devdigest/shared` (Zod contracts) is canonical in `server/src/vendor/shared`;
  `client/src/vendor/shared` is a separate vendored copy (see the shared AGENTS.md).
- Migrations don't run on boot: after a schema change, run `pnpm db:generate` + `pnpm db:migrate` in `server/`.

## Where things go
Every package (and the root) has the same layout:
- `README.md`: for humans (what it is, how to run it, architecture).
- `AGENTS.md`: for agents (commands, boundaries, conventions, pointers) — the file you edit.
- `CLAUDE.md`: a three-line shim that imports the sibling `AGENTS.md`, because Claude Code reads
  only `CLAUDE.md`. Never put content here; `scripts/check-agent-docs.sh` checks the pairing.
- `docs/`: how things **are** (deep dives, ADRs in `docs/adr/NNNN-title.md`).
- `specs/`: how things **will be**, one spec per feature (format in [specs/README.md](specs/README.md)).
- `INSIGHTS.md`: append-only log of non-obvious gotchas.

A feature spanning several packages gets its spec in root `specs/`; a single-package one goes in `<pkg>/specs/`.

## Workflow: 5 phases
Every task goes through these phases in order. For spec'd features, log each phase in the spec's `## Phases` table.

1. **Initiation:** understand the request.
   - Check `specs/` and `<pkg>/specs/` for an existing spec.
   - Read the root [INSIGHTS.md](INSIGHTS.md) and the `INSIGHTS.md` of every package you will touch.
   - Treat entries as high-confidence guidance unless the code now says otherwise.
2. **Planning:** write or update the spec (`status: draft` → `approved`).
   - Agree on decisions with the user.
   - Plan the files, tests and verification.
3. **Implementation:** code and tests (`status: in-progress`), following the conventions above.
   - When a non-obvious dependency, fix, measured fact, odd finding, tool quirk, or LLM/review-engine behavior is confirmed, record it right away with the [`engineering-insights`](.claude/skills/engineering-insights/SKILL.md) skill.
   - Each record is dated, has `file:line` evidence, and goes in the INSIGHTS.md of the module you worked in.
4. **Validation:** run typecheck, lint and tests for every touched package (see Verify).
   - Run `./scripts/e2e.sh` when the UI or seed changed.
   - Do a manual check on the dev app for user-visible changes.
5. **Completion:**
   - Set the spec to `status: done` and move durable explanations into `docs/`.
   - Run the `engineering-insights` wrap-up (automatic; don't wait to be asked).
   - Before opening, pushing or merging a PR, the user runs `/pr-self-review` ([skill](.claude/skills/pr-self-review/SKILL.md)).
     It is manual-only (`disable-model-invocation: true`), so an agent asks the user to run it rather than invoking it.
     It reviews every local change with the skills that match each file. Any `CRITICAL` blocks the PR:
     `.claude/hooks/pr-self-review-gate.py` denies `gh pr create|merge|ready` and `git push` until a passing review covers the exact diff.
     Never bypass it (`--no-verify`, hand-editing `.claude/.pr-self-review/`).
   - Commit and open a PR when asked.

The insights loop is automatic. A `UserPromptSubmit` hook (`.claude/hooks/insights-session-start.py`) runs on each
session's first request: it wraps up the previous session if that session edited files without one, then does the INSIGHTS read.
INSIGHTS.md is edited only when there's news.
