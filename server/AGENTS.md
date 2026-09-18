# server — `@devdigest/api`

Fastify 5 + Drizzle ORM over Postgres (pgvector). Architecture, request/DI flow,
API map, env vars: [README.md](README.md)

## Commands (pnpm)
- `pnpm dev` (:3001) · `pnpm typecheck` · `pnpm lint` (ESLint flat config, `eslint.config.mjs`) · `pnpm build`
- `pnpm db:generate` → `pnpm db:migrate` after schema changes (not applied on boot) · `pnpm db:seed` (idempotent)
- Unit (no Docker): `pnpm exec vitest run --exclude '**/*.it.test.ts'`
- Integration (Docker): `pnpm exec vitest run .it.test` · both: `pnpm test`

## Boundaries
- Features are self-contained plugins in `src/modules/<name>/` (own `routes.ts`),
  registered statically in `src/modules/index.ts`.
- External systems (LLM, GitHub, git, ast-grep, tokenizer, secrets) go through
  adapters behind the DI container (`src/platform/container.ts`); mocks in `src/adapters/mocks.ts`.
- Secrets are read only via `LocalSecretsProvider` (`src/adapters/secrets/local.ts`) — never from `AppConfig`, DB, or logs.
- Review logic belongs in `reviewer-core` (aliased as source); the server gathers inputs and persists results.

## Conventions
- Zod contracts from `@devdigest/shared` are the route schemas (`fastify-type-provider-zod`);
  don't hand-roll `Schema.parse(req.body)` in handlers.
- Plugins (helmet, cors, rate-limit, SSE) register before modules.
- A test importing `test/helpers/pg.ts` **must** be named `*.it.test.ts`; everything else stays hermetic.
- `package.json` may be `skip-worktree` in some clones (check `git ls-files -v package.json`: `S`). CI uses `pnpm exec …`, not package scripts.

## Know before you edit
- Gotchas: [INSIGHTS.md](INSIGHTS.md) · Deep dives: [docs/](docs/README.md) · Planned work: [specs/](specs/README.md)
- Contracts: [src/vendor/shared/AGENTS.md](src/vendor/shared/AGENTS.md)
- Skills: `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `zod`, `security`
