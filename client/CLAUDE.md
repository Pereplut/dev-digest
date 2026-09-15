# client — `@devdigest/web`

Next.js 15 (App Router) + React 19 studio UI over the Fastify API.
Route map and stack: [README.md](README.md)

## Commands (pnpm)
- `pnpm dev` (:3000, needs API on :3001) · `pnpm build` · `pnpm typecheck` · `pnpm lint` (ESLint 9 + eslint-config-next via FlatCompat; `next build` skips lint)
- `pnpm test` — vitest + jsdom, `fetch` mocked (no API needed)

## Boundaries
- All HTTP goes through `src/lib/api.ts` (`NEXT_PUBLIC_API_BASE`); every data hook lives in `src/lib/hooks/*` (TanStack Query).
- UI primitives come from `@devdigest/ui` (`src/vendor/ui`); contracts from `@devdigest/shared` (`src/vendor/shared`, a vendored copy — see [shared CLAUDE.md](../server/src/vendor/shared/CLAUDE.md)).
- Real browser journeys are covered in [`../e2e`](../e2e/CLAUDE.md), not here.

## Conventions
- Pages (`src/app/**/page.tsx`) stay thin; feature logic lives in colocated `_components/<Name>/` folders, each with its own `*.test.tsx`.
- App chrome (nav, breadcrumbs, `g`-then-key shortcuts) lives in `src/components/app-shell`.
- User-facing strings go through `next-intl`: `messages/<locale>/*.json`, no hardcoded copy.

## Know before you edit
- Gotchas: [INSIGHTS.md](INSIGHTS.md) · Deep dives: [docs/](docs/README.md) · Planned work: [specs/](specs/README.md)
- Skills: `next-best-practices`, `react-best-practices`, `react-testing-library`, `typescript-expert`
