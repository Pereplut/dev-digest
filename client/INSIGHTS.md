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

### 2026-09-18 — [tool] Swapping `fireEvent` for `user-event` changes what a hover/focus component test asserts
**Context:** migrating the suite's 25 `fireEvent` call sites to `@testing-library/user-event` (plan item C7).
**Insight:** `fireEvent.click` dispatches one event; `user.click` replays hover → focus → click. Against `FindingsPopover` that inverts outcomes, because **focus opens the card and Enter toggles it** — so the focus-then-Enter sequence user-event produces closes what the old test opened. Two further traps: at `delayMs={0}` the `CLOSE_DELAY_MS` grace period is disabled, so a realistic pointer move from trigger to card fires `mouseleave` and unmounts the card before the click can land; and at the default `delayMs={150}` the open is scheduled on a timer, making focus-then-Enter a wall-clock race rather than a deterministic sequence.
**Apply:** treat this migration as per-test reasoning, never a codemod. Migrate where the component is synchronous (`delayMs={0}`) and start each test from the state it actually wants; keep `fireEvent` where a delay timer would make it flaky, and record why in the file header. 16 of 25 sites migrated, 9 kept deliberately (`RunHistory`, `PRRow`, one in-card click).
**Evidence:** `client/src/components/findings-summary/FindingsPopover.tsx:137` (focus opens), `:140-147` (Enter toggles), `:22,32` (`CLOSE_DELAY_MS` and the `delayMs` default); `client/src/components/findings-summary/FindingsPopover.test.tsx` (8/8 after restructuring).

### 2026-09-18 — [tool] `vi.fn(impl)` types `mock.calls` from the impl's own parameters, so a zero-arg stub cannot be asserted on
**Context:** writing the first tests for `lib/api.ts`; the fetch stub started life as `vi.fn(async () => response({}))`.
**Insight:** Vitest infers the mock's signature from the function handed to `vi.fn`, not from how the code under test calls it. A zero-parameter impl therefore types `mock.mock.calls` as `[][]`, and reading the URL or the `RequestInit` back fails to compile — `TS2493: Tuple type '[]' of length '0' has no element at index '1'` — while the tests themselves pass at runtime. Declaring the impl with `fetch`'s real signature restores the tuple. Note the split: **14/14 tests green and `pnpm typecheck` reporting 4 errors at the same time**, so a green suite says nothing about test-code types.
**Apply:** type a stub by the signature it replaces, not by the arguments it happens to ignore. Assert on call arguments through a small typed helper rather than indexing `mock.mock.calls` inline. This is only visible because client tests are type-checked (plan item E6 did the same for `server/`) — without that the broken typing ships silently.
**Evidence:** `client/src/lib/api.test.ts:36-37` (the typed `stubFetch`), `:43,52` (the `initOf` / `urlOf` accessors).

### 2026-09-19 — [tool] Next 15 rejects `export *` in a `"use client"` module — but only once a Server Component imports it
Supersedes: "A vendored module that uses hooks without `"use client"` forces the directive onto all 52 consumers" (its `export *` recipe).
**Context:** pr-self-review flagged `ui-client.ts` (`"use client"; export * from "@devdigest/ui"`), which existed so Server Components could import the kit.
**Insight:** Next's flight loader errors with "It's currently unsupported to use "export *" in a client boundary" when a Server Component imports such a module; it built only because every importer was itself a client module. The wrapper now lists the kit's names explicitly.
**Apply:** a new kit component must be added by name to `ui-client.ts`; never reintroduce `export *` there.
**Evidence:** `client/src/components/ui-client.ts:20`; `client/node_modules/next/dist/build/webpack/loaders/next-flight-loader/index.js:105`.

### 2026-09-19 — [dep] A VALUE import from `@devdigest/shared` passes typecheck and vitest but breaks `next dev`/`next build`
**Context:** the new Skills page imported `SkillType`/`SkillDraft` (Zod schemas) at runtime; typecheck and 145 tests were green, the page was a Build Error.
**Insight:** the vendored contracts barrel re-exports with `.js` specifiers (`export * from './contracts/findings.js'`) that webpack cannot resolve; tsc and vitest can, so only a real Next compile catches it. Every existing client import from it was `import type`.
**Apply:** client code takes only types from `@devdigest/shared`; mirror constants/limits locally. Now enforced: `@typescript-eslint/no-restricted-imports` with `allowTypeImports` — and open a new page in the dev app, tests alone don't prove it builds.
**Evidence:** `client/src/vendor/shared/index.ts:17`; `client/eslint.config.mjs` (`@devdigest/shared` path rule); `client/src/app/skills/_components/SkillForm/constants.ts:1`.

### 2026-09-19 — [odd] The kit `Donut` always formats values as money; `Toggle` has no accessible-name prop
**Context:** building the skill Stats tab and SkillCard (spec 0006) on the vendored kit.
**Insight:** `Donut` renders every value as `valuePrefix + value.toFixed(2)` with `valuePrefix = "$"`, so it can't show counts; `Toggle` takes no `aria-label`, so its `role="switch"` has no name. Neither can be fixed in `src/vendor/ui`.
**Apply:** counts → draw a recharts `PieChart` + own legend (as StatsTab does); a named switch → wrap the Toggle in a `<label>` with visually hidden text (as SkillCard does).
**Evidence:** `client/src/vendor/ui/charts/Donut.tsx:15,49`; `client/src/vendor/ui/primitives/Toggle.tsx:3`; `client/src/app/skills/_components/SkillCard/SkillCard.tsx:53`.

### 2026-09-19 — [tool] dnd-kit keyboard sorting finds no drop target in jsdom
**Context:** testing Space → ArrowDown → Space reordering in the agent SkillsTab.
**Insight:** `sortableKeyboardCoordinates` picks the next item by geometry, and jsdom returns 0×0 rects for everything, so a keyboard move does nothing. Stubbing `HTMLElement.prototype.getBoundingClientRect` to stack rows by index makes it work; keys must be sent as `user.keyboard("[Space]")` / `"[ArrowDown]"` (KeyboardSensor reads `event.code`).
**Apply:** reuse `stubRowGeometry` for any dnd-kit keyboard test and restore it in `afterEach`.
**Evidence:** `client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.test.tsx:92`.

### 2026-09-20 — [fix] N parallel optimistic mutations from one click roll each other back
**Context:** "Deselect all" on the Conventions page fired one `usePatchConvention` PATCH per accepted card; flagged by pr-self-review (react-best-practices).
**Insight:** each call runs its own `onMutate`, snapshotting the cache and returning it as context. The snapshots are taken *concurrently*, so they all predate the siblings' writes — one failing request's `onError` restores a snapshot from before the others and silently reverts their successful updates too. Nothing corrects it afterwards, because that hook's `onSettled` invalidates only the skill-defaults key, never the list.
**Apply:** a bulk action gets ONE mutation over an id list (one snapshot, one rollback) and invalidates the list in `onSettled`. Never `forEach` over an optimistic mutation.
**Evidence:** `client/src/lib/hooks/conventions.ts:96` (`useBulkPatchConventions`); regression test `client/src/app/conventions/_components/ConventionsView/ConventionsView.test.tsx` ("deselects every accepted candidate in ONE bulk mutation").

### 2026-09-20 — [fix] Gating render on `data` for a query the same flag enables makes a dead button
**Context:** `{modalOpen && defaults.data ? <CreateSkillModal …/> : null}`, where `useConventionSkillDefaults(repoId, modalOpen)` is `enabled: modalOpen`.
**Insight:** on a failed fetch there is no `data`, so nothing renders while `modalOpen` stays `true` — and clicking again re-sets the same value, so React does not re-render and TanStack does not refetch. The button is permanently dead with no error shown, because `lib/providers.tsx` toasts only status 0 and 5xx, so a 4xx is silent.
**Apply:** when one state flag both enables a query and gates its render, handle `isError` explicitly (close and toast, or render the error with a retry). Don't leave the open state on with a falsy `data` as the only signal.
**Evidence:** `client/src/app/conventions/_components/ConventionsView/ConventionsView.tsx:52` (the `defaultsFailed` effect); `client/src/lib/providers.tsx:38` (the 4xx-silent toast rule).

### 2026-09-20 — [fix] TanStack keeps `isError` true while a re-enabled query refetches, so an `isError` effect fires once more
Extends: "Gating render on `data` for a query the same flag enables makes a dead button"
**Context:** the `defaultsFailed` effect added to fix that dead button — `modalOpen && defaults.isError` → close the modal and toast. Caught by pr-self-review (react lens) one round after the fix landed.
**Insight:** a query's `status` stays `'error'` across the next refetch; only `isFetching` flips. So the click AFTER a failure re-enabled the query, the effect saw the PREVIOUS error on the very first render, and it closed the just-opened modal and toasted again before the refetch could settle. The dead button was not fixed, only shortened — from permanently dead to one extra dead click per failure.
**Apply:** an effect keyed on `isError` for a query that gets re-enabled must also require `!isFetching`, otherwise it acts on a stale failure. Reach for `isFetching` whenever "has it failed?" is asked at the moment a query restarts.
**Evidence:** `client/src/app/conventions/_components/ConventionsView/ConventionsView.tsx:64` (`modalOpen && defaults.isError && !defaults.isFetching`); regression test `ConventionsView.test.tsx` ("keeps the modal open while the previously failed draft query is refetching") — without `!isFetching` the toast appears and the test fails.

### 2026-09-20 — [tool] The vendored `Modal` renders its title in a plain div, so `getByRole("heading")` can never match it
**Context:** asserting that the conventions "Create skill" modal is open. A pre-existing test used `queryByRole("heading", { name: /Create skill from conventions/i })` and asserted its ABSENCE — which passed for the wrong reason.
**Insight:** `client/src/vendor/ui/kit/Modal.tsx:53` renders `title` inside `<div style={{ fontSize: 16, fontWeight: 700 }}>`. There is no heading element and no `aria-labelledby`, so a `heading` query never matches whether the modal is open or closed: a negative assertion on it is vacuous, and a positive one always fails. The dialog wrapper DOES set `role="dialog" aria-modal="true"` (:26-27), so that is the handle to use.
**Apply:** assert a vendored-kit modal with `getByRole("dialog")` and `within(dialog).getByText(title)`; never `getByRole("heading")`. A negative role assertion is only meaningful once the positive form has been seen to pass.
**Evidence:** `client/src/vendor/ui/kit/Modal.tsx:53` (the div), `:26` (`role="dialog"`); `client/src/app/conventions/_components/ConventionsView/ConventionsView.test.tsx` now queries the dialog and fails with `Unable to find role="dialog"` when the modal is wrongly closed.

### 2026-09-24 — [tool] `FindingCard`'s header is itself `role="button"`, so a regex name query matches it too
**Context:** a new `DiffTab.test.tsx` clicked the inline finding's Accept with `getByRole("button", { name: /Accept/ })` and failed with "Found multiple elements" — one card on screen, two matching buttons.
**Insight:** the card header is a `div role="button" tabIndex={0}` that WRAPS the Accept and Reject `<button>`s, because nesting a real button inside a button is invalid HTML. An element's accessible name is computed from its descendants, so the header's name is the whole concatenation — title, category, `file:line`, "Accept", "Reject" — and any substring/regex name query matches both the header and the control inside it. An exact name (`{ name: "Accept" }`) matches only the inner button; the header's name is far longer.
**Apply:** query this card's controls by EXACT accessible name, never a regex. More generally: a `role="button"` wrapper around other controls makes every regex name query on that subtree ambiguous, and the error ("multiple elements") points at the query, not at a double render — check `document.querySelectorAll("[data-finding-id]").length` before assuming the component rendered twice.
**Evidence:** `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:61-64` (the wrapper, with `:57-60` explaining why it is not a real button) and `:96-115` (the nested Accept/Reject); instrumented run printed `CARDS: 1 BTNS: 2`.
