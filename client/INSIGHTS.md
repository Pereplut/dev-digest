# Insights — client

Append-only log of non-obvious client learnings. Newest at the bottom.
Format: `### YYYY-MM-DD — [dep|fix|measured|odd|tool|llm] title` then **Context / Insight / Apply / Evidence** (`file:line` required).
Written via the [`engineering-insights`](../.claude/skills/engineering-insights/SKILL.md) skill.

---

### 2026-09-15 — [dep] Trace documents written before migration 0010 have no cost
**Context:** adding the COST tile to the run trace drawer.
**Insight:** `run_traces.trace` is a stored jsonb snapshot, so `stats.cost_usd` is simply absent for older runs; the `agent_runs` row (`RunSummary.cost_usd` from `usePrRuns`) is the reliable source, and an unfinished run must never show a price.
**Apply:** read run cost from the run row first and fall back to `trace.stats.cost_usd`; never assume new `RunStats` fields exist on old traces.
**Evidence:** `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:32`.

### 2026-09-15 — [fix] Two `next dev` servers in client/ share `.next`, and the API address is compiled in
**Context:** after `./scripts/e2e.sh`, the dev web app on :3000 showed "Cannot reach the DevDigest engine at http://localhost:3101" although the dev API on :3001 was healthy.
**Insight:** e2e's `next dev` (`NEXT_PUBLIC_API_BASE=:3101`) wrote into the same `client/.next` as the dev server, and `NEXT_PUBLIC_*` values are inlined into the compiled chunks — so :3000 kept calling the throwaway API after the script shut it down. `client/.env` was correct the whole time.
**Apply:** give any second `next dev` its own `distDir` (`NEXT_DIST_DIR`); to recover, stop the dev server, `rm -rf client/.next`, restart. Diagnose with `grep -rl 'localhost:3101' client/.next`.
**Evidence:** `client/next.config.mjs:11`; `scripts/e2e.sh:47`.

### 2026-09-15 — [tool] `next dev` rewrites tsconfig.json and next-env.d.ts for a custom distDir
**Context:** running e2e with `NEXT_DIST_DIR=.next-e2e` left `client/tsconfig.json` (reformatted, `.next-e2e/types` added to `include`) and `client/next-env.d.ts` (route types path → `.next-e2e`) modified in git.
**Insight:** Next regenerates both files for whichever build folder the last-started dev server uses, so they flip between runs.
**Apply:** never commit those rewrites; `scripts/e2e.sh` snapshots both files at start and restores them in `cleanup()`.
**Evidence:** `scripts/e2e.sh:91` (snapshot), `scripts/e2e.sh:83` (restore on exit).

### 2026-09-15 — [tool] eslint-config-next 15.5 caps ESLint at 9 and still ships legacy configs
**Context:** adding `pnpm lint` to the client (homework criterion 4); the latest `eslint` on npm is 10.x.
**Insight:** `npm view eslint-config-next@15.5.19 peerDependencies` → `eslint: ^7.23.0 || ^8.0.0 || ^9.0.0`, so ESLint 10 is unsupported. Its presets are eslintrc-style, so a flat `eslint.config.mjs` must load them through `FlatCompat` from `@eslint/eslintrc`.
**Apply:** keep the client on `eslint@9.x` until the Next major that supports ESLint 10; don't bump eslint alone. Lint with `pnpm lint` (`eslint .`), not the deprecated `next lint`.
**Evidence:** `client/eslint.config.mjs:3-9` (FlatCompat + the ≤ 9 note); `client/package.json` devDependencies `eslint 9.39.5`, `eslint-config-next 15.5.19`.
