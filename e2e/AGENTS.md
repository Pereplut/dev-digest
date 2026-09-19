# e2e — `@devdigest/e2e`

Deterministic browser flows for the web app via the agent-browser CLI (no Playwright, no LLM).
Flow format, env knobs, coverage table: [README.md](README.md)

## Commands (npm)
- Hermetic (recommended): `./scripts/e2e.sh` from repo root — isolated seeded stack on :5433/:3101/:3100
- Against a running stack: `npm test` (only safe if the dev DB holds just the seeded repo)
- `npm run typecheck` · `npm run lint` (ESLint flat config; lints `run.ts` + `lib/`)

## Boundaries
- Browser flows live in `flows/NN-name.flow.json`, run in lexical order by `run.ts`.
  (`specs/` is for feature specs, like every other package.)
- Flows use the seeded data only (`acme/payments-api`, PR #482, built-in agents) and nothing may
  trigger a model call. All but one are read-only — see the mutating-flow exception below.

## Conventions
- Deterministic locators only (`wait --url`, `wait --text`, `find role|text|label [--exact]`, and `wait --fn "!…innerText.includes(…)"` for text that must disappear); never the AI `chat` command. Details: [docs/locators.md](docs/locators.md).
- Read-only by default: never click mutating controls (Accept/Reject, Delete, Run review), and undo
  any filter a flow toggles. **One exception**: a flow may declare `"mutates": true`, which the
  runner skips unless `E2E_ALLOW_MUTATING=1` (CI sets it; `npm test` against a dev DB does not, and
  a rejection cannot be undone from the UI). Such a flow must sort LAST — all flows share one seeded
  stack — and must still never trigger a model call. `09-pr-finding-actions` is the only one.
- A non-zero command exit is the assertion; add `"assert": { "stdoutIncludes": … }` only when needed.
- Every step gets a human `label`. When adding a flow, add a row to the README coverage table.

## Know before you edit
- Gotchas: [INSIGHTS.md](INSIGHTS.md) · Deep dives: [docs/](docs/README.md) · Planned work: [specs/](specs/README.md)
