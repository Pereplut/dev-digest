# Hermetic e2e stack

`./scripts/e2e.sh` runs every browser flow against a throwaway, freshly seeded stack. It never
touches the dev DB and can run while the dev stack is up.

## What it does
1. **Config:** reads env overrides.
   - Postgres port: `E2E_PG_PORT`, default in the script. README says `:5433`; change it if that port is taken.
   - API port: `E2E_API_PORT`, default `:3101`.
   - Web port: `E2E_WEB_PORT`, default `:3100`.
   - It exports `DATABASE_URL`, `NEXT_PUBLIC_API_BASE` and `E2E_BASE_URL` **before** any `tsx`/`next` process starts, so dotenv can't override them.
2. **Postgres:** starts an ephemeral `pgvector/pgvector:pg16` container with no volume, so the DB is empty on every run.
3. **Guard:** refuses to migrate or seed unless `DATABASE_URL` points at the isolated port.
4. **Migrate and seed:** runs `pnpm db:migrate` and `pnpm db:seed`. The seed creates `acme/payments-api`, PR #482, its review (1 CRITICAL + 1 WARNING) and two done runs (General `$0.0149` with the review, Security `$0.0011` without one).
5. **API:** starts the server on the API port and waits for `/health`.
6. **Web:** runs `next dev` on the web port with `NEXT_DIST_DIR=.next-e2e`. The separate build folder keeps it from overwriting the dev server's `client/.next`, which would inline the wrong `NEXT_PUBLIC_API_BASE`.
7. **Flows:** runs `cd e2e && npm test` (`run.ts`), which executes `flows/*.flow.json` in lexical order.
8. **Cleanup (trap on EXIT/INT/TERM):**
   - kills the API and web processes
   - removes the container
   - restores `client/tsconfig.json` and `client/next-env.d.ts`, which `next dev` rewrites for a custom `distDir`

## Values the flows depend on
| Flow | Asserts | Comes from |
|---|---|---|
| 02 | `$0.016` | Sum of **all** done runs (0.0149 + 0.0011), in `server/src/modules/pulls/routes.ts` |
| 02 | chips named "1 critical, 1 warning", title "2 FINDINGS IN THIS RUN" | The latest run with a review is General |
| 04 | `$0.015` on the Timeline | General run cost |
| 04 | "1 CRITICAL", "1 WARNING" pills; filter hides the Stripe card | The seeded review's 2 findings |

Changing the seed means updating these flows, `server/test/integration.it.test.ts` and `server/INSIGHTS.md` together.

## CI
`.github/workflows/e2e-web.yml` builds its own stack (a service Postgres with a fresh seed) and
calls `npm test` directly; it doesn't use this script.
