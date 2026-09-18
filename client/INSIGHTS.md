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

### 2026-09-18 — [dep] Adding `eslint.config.mjs` turns `next build` into a lint gate in a different workflow
**Context:** giving the client a `pnpm lint` (homework criterion 4).
**Insight:** once an ESLint config exists in `client/`, `next build` lints as part of the build — and `next build` is run by the **e2e-web** workflow, not by the lint task. `eslint: { ignoreDuringBuilds: true }` in `next.config.mjs` is what keeps the build independent of lint findings. (The breakage was prevented, not observed: the verification build passed with the flag in place.)
**Apply:** when adding a lint config to a Next package, set `ignoreDuringBuilds` in the same change, or expect an unrelated CI job to start failing on lint.
**Evidence:** `client/next.config.mjs:12-14` (the flag and its comment).

### 2026-09-18 — [tool] A manual `pnpm build` with `NEXT_DIST_DIR` also rewrites tsconfig.json / next-env.d.ts
Extends: "`next dev` rewrites tsconfig.json and next-env.d.ts for a custom distDir"
**Context:** a one-off `NEXT_DIST_DIR=.next-buildcheck pnpm build` to verify the client still builds.
**Insight:** `next build` rewrites both files for its dist dir exactly as `next dev` does, but a manual build is outside `scripts/e2e.sh`, so nothing restores them — they show up modified in `git status` afterwards.
**Apply:** back both files up before a manual build with a custom dist dir and copy them back, or `git checkout -- tsconfig.json next-env.d.ts` after.
**Evidence:** `scripts/e2e.sh:91` (the snapshot that only covers the script's own runs), `client/next.config.mjs:11`.

### 2026-09-18 — [dep] The client is on Next 15, but current Next.js docs describe 16 — check the version before applying any advice
**Context:** researching App Router architecture for the `react-code-organization` skill; every page fetched from nextjs.org self-reported `version: 16.3.5`.
**Insight:** this client runs **15.5.19** (`next: ^15.1.3` in the manifest, 15.5.19 installed), so a sizeable part of today's official documentation describes APIs that do not exist here: `proxy.ts` (v16 — in 15 the convention is still `middleware.ts`, and `proxy` doesn't support the Edge runtime at all), mandatory `default.js` for every parallel-route slot, `retry()` in `error.tsx` (15 has `reset()`), generated global types `PageProps<'/route'>` / `LayoutProps<'/route'>` (v16 typegen — type params by hand on 15), `cacheComponents` (15 has `experimental.ppr`), `updateTag()`, and the removal of `next lint`. Async `params`/`searchParams`/`cookies()` are **not** a difference — those already apply in 15. nextjs.org serves only current docs, with no version switcher back to 15, so the mismatch is silent.
**Apply:** before following any nextjs.org page, check `client/package.json`; treat v16-only APIs as an upgrade checklist, not current advice. The skill tags them `[v16]` for exactly this reason. Nothing in the repo triggers the v16 breakages today — there is no `middleware.ts`, no parallel routes and no `error.tsx` — so an upgrade is unblocked, not overdue.
**Evidence:** `client/package.json:17` (`"next": "^15.1.3"`), `:36` (`eslint-config-next 15.5.19`); `.claude/skills/react-code-organization/SKILL.md:193` (the `[v16]`-tagged section).

### 2026-09-18 — [dep] Every `messages/en/*.json` file ships to every route, used or not
**Context:** 12 of 18 i18n namespaces had zero `useTranslations` consumers.
**Insight:** `loadMessages` `readdirSync`s the whole locale directory and merges it into one object, which `layout.tsx` hands to `NextIntlClientProvider` at the ROOT — so every namespace is serialized into the RSC payload of every page, whether any component reads it or not. The 12 unused files were **16,443 of 37,597 bytes (44%)** of that payload, paid by every user on every navigation, and nothing in lint, typecheck or tests notices. Deleting them took the total to 21,154 bytes; e2e stayed 7/7.
**Apply:** adding a `messages/en/<ns>.json` for a feature that has not shipped yet is not free — it is a per-page tax. Delete the file until the feature lands, or load namespaces per route instead of merging the directory.
**Evidence:** `client/src/i18n/request.ts:19-24` (the `readdirSync` merge), `client/src/app/layout.tsx:28` (root provider).

### 2026-09-18 — [dep] A vendored module that uses hooks without `"use client"` forces the directive onto all 52 consumers
**Context:** `src/vendor/ui` uses hooks in 10 modules and declares no directive; we do not edit vendored code (root AGENTS.md "Do not touch").
**Insight:** without the directive the kit cannot be imported from a Server Component at all, and every consumer has to declare the boundary itself — which is the mechanical reason the client graph is 62 modules wide, not a design choice. Editing the vendored barrel would fix it but is silently lost on the next re-vendor. A first-party re-export module (`src/components/ui-client.ts`: `"use client"; export * from "@devdigest/ui";`) puts the boundary in code we own, so a re-vendor cannot drop it, and `no-restricted-imports` keeps the kit reachable only through it.
**Apply:** when vendored code is missing a directive/shim, wrap it in a first-party module and lint the direct path shut, rather than patching the vendored file. Verify the rule actually fires (a throwaway probe file — NOT a tracked one, since `git checkout --` would revert uncommitted work).
**Evidence:** `client/src/components/ui-client.ts:20`; `client/eslint.config.mjs` (`no-restricted-imports` + the wrapper override).
