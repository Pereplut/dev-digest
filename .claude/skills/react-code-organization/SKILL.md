---
name: react-code-organization
description: "Where React/frontend code belongs: which folder a component goes in, when to split it, where business logic lives, and where constants, utils, types and hooks go — including Next.js App Router architecture (app/ vs features, route groups, the 'use client' boundary as a seam, Data Access Layer, where Server Actions live, which segment owns a failure). Use when creating a new component/feature/hook/route, deciding a file's location or name, reviewing structure, extracting logic out of a component, or debating barrel files, enums, feature folders, `utils/`, or layout vs page responsibilities. Complements react-best-practices (whether code is correct) and next-best-practices (Next mechanics and performance)."
version: 1.1.0
---

# React Code Organization

**Placement decisions, not correctness.** This skill answers *"where does this code belong?"*
Its sibling `react-best-practices` answers *"is this code correct?"* — see
[Relation to other skills](README.md#relation-to-other-skills).

Rules are tagged for consuming agents, matching `react-best-practices`:
- **CRITICAL** — violating it creates cross-feature coupling, cycles, or unreviewable files
- **HIGH** — will hurt build/test speed or scaling
- **MEDIUM** — maintainability and consistency

Every rule here traces to a dated, verified source in [README.md](README.md). Where good
sources genuinely disagree, this skill makes one call and says so: see
[Deliberate choices](#deliberate-choices-where-sources-disagree).

---

## Quick lookup

| You have… | It goes… |
|---|---|
| A component used by one route | Inside that route/feature, colocated |
| A component used by two features | The shared components layer — **on the second consumer, not in anticipation** |
| Logic that calls hooks | A custom hook, named for a concrete use case |
| Logic that calls no hooks | A plain function — `getSorted`, never `useSorted` |
| A pure domain rule / calculation | A plain TS module, testable with no renderer |
| Server data | A query cache keyed by resource, wrapped in one hook per resource |
| A magic value used once | Module scope at the top of that file, below the imports |
| A value several files in a feature share | `constants.ts` in that feature |
| A fixed set of values | A string-literal union; `as const` object if you need them at runtime |
| A type used once | The same file that uses it |
| A type used in several files | `*.types.ts` at the narrowest enclosing scope |
| A generic pure function | A **domain-named** module (`format-currency.ts`), never `utils.ts` |
| Secrets, DB access, authorization | Server-only code. Never the frontend — frontend rules are UX, not a security boundary |

---

## 1. Project structure — where files go

- **CRITICAL — Group by feature/domain at the top level.** Type-named folders (`components/`,
  `hooks/`, `utils/`) are legitimate *inside* a feature or inside the shared layer, never as the
  top-level architecture. Redux's own style guide, Angular v22, Bulletproof React, FSD and Nx all
  converge here; Angular forbids `components/`-style directories outright.
- **CRITICAL — No feature imports another feature.** Compose features at the app/route layer.
- **CRITICAL — Dependencies flow one way: `shared → features → app`.** Enforce it with ESLint
  `import/no-restricted-paths` zones, not prose. *A structure convention with no linter is a
  suggestion* — every source operating at scale ships a rule.
- **HIGH — Colocate by default; distance is a cost you justify.** Tests, styles, types, constants
  and single-use hooks live next to their component. Exception: integration/E2E tests span
  components and survive refactors, so they live at the project root.
- **HIGH — Promote on the second consumer.** One feature uses it → it stays in that feature. Two
  need it → move it up, one level at a time. Never promote in anticipation.
- **MEDIUM — Keep the tree shallow: 2–3 levels, hard cap 4.** Consider splitting a folder around
  7–10 files. These are heuristics; say so when citing them.
- **MEDIUM — The routing directory is for routing.** Route-private UI colocates inside the route
  (`app/**/_components/`); genuinely shared code lives outside it. Next.js is explicitly
  unopinionated — `components`/`lib` in its examples have "no special framework significance."
- **MEDIUM — Don't design the tree on day one.** Start flat; restructure when navigation hurts.

## 2. Decomposition — how components divide

- **CRITICAL — Split on a named problem, never preemptively.** Legitimate triggers: a second real
  consumer, re-render cost you measured, state/handler confusion, you can't test it in isolation,
  merge-conflict friction, a library that needs a boundary. Length alone is not one.
- **CRITICAL — One responsibility per component** (react.dev: "a component should ideally only be
  concerned with one thing"). The usable test: can you name what it does in one sentence?
- **HIGH — Don't reach for context to stop prop drilling.** The escalation is props → **extract a
  component and pass JSX as `children`** → context. Drilling usually means a missing component,
  not a missing store. Reserve context for theming, current user, routing, genuinely distant
  consumers.
- **HIGH — `children` is the default extension point.** Escalate to named slot props only when
  consumers must replace *internal* structure.
- **HIGH — Booleans for exactly 2 states; a `variant`/`size` enum beyond that.** n mutually
  exclusive booleans encode 2ⁿ states, most of them impossible.
- **HIGH — Push `'use client'` to the leaves.** The directive marks a module *and every transitive
  import* as client code, so boundary placement is a bundle-size decision. Split a mixed component
  into a server data parent plus a client interactive leaf; pass server-rendered output through
  `children` to keep it off the client graph. Render providers as deep as possible.
- **MEDIUM — Invert control only when options multiply.** Compound components (context-based),
  then render props, then headless hooks — never for a single caller.
- **MEDIUM — Don't split to enable memoization.** The React Compiler handles memoization with no
  architectural change. Colocate state, accept `children`, pass primitives. Split for
  responsibility.
- **Size signals, not targets.** Empirical 90th-percentile tails from the 10 most-starred React
  repos: **>13 props**, **>116 LOC** per component, **>225 LOC** per file, **>2 methods returning
  JSX**. Enforceable proxies: `max-lines` 300/file, `max-lines-per-function` 50,
  `sonarjs/cognitive-complexity` 15. Treat all of these as smoke alarms — the study found *every*
  project had large components.

## 3. Business logic — which layer owns it

The layering, stated once:

| Layer | Owns | Test |
|---|---|---|
| **Component / JSX** | Rendering, event wiring | — |
| **Custom hook** | State, subscriptions, context, queries, mutations, form wiring, "when" | Calls at least one hook |
| **Plain TS module** | Domain rules, calculations, mappers, reducers, schemas | Runs with no renderer |
| **Server** | Secrets, DB access, authorization, canonical validation | — |

- **CRITICAL — Business rules may be *called* from JSX, never *defined* there.**
- **CRITICAL — Extract to a hook only if it calls hooks.** Otherwise it's a plain function; drop
  the `use` prefix so it can be called conditionally. react.dev marks `useSorted(items)` 🔴 and
  `getSorted(items)` ✅.
- **CRITICAL — Never build lifecycle wrappers** (`useMount`, `useEffectOnce`, `useUpdateEffect`).
  Name hooks for concrete use cases (`useChatRoom`, `usePrRuns`).
- **CRITICAL — Server-side authority is not delegable.** Re-verify auth *inside* every server
  action — a page-level check does not extend to actions defined in it — check resource ownership,
  and re-validate every input server-side regardless of client validation.
- **HIGH — Two placement tests, applied in order.** *Framework test:* would this rule still matter
  if the UI were rebuilt in another framework, or shipped as a mobile app? → it isn't a component's
  job. *Import smell test:* if a function imports `toast`, `useMutation` or a styling lib, it's
  presentation or orchestration, not domain.
- **HIGH — Server state is a cache, not app state.** It's remote, shared-ownership and staleable.
  Keep it in a query cache keyed by resource, wrapped in one custom hook per resource. Copying it
  into `useState` or a store forfeits background updates.
- **HIGH — Never sync; derive.** Effects are for external side effects only. Derived values,
  adjusted selections, and client state that depends on server state are **computed**, not
  stored-and-synced. Reset state with `key`, not an Effect. Subscribe with `useSyncExternalStore`.
- **HIGH — State placement escalates:** local → lifted to the nearest common owner → context (only
  after props and `children` extraction fail) → a store, and a store only on real signals (state
  needed in many places, frequent updates, complex update logic, large team). Context transports;
  it does not manage.
- **MEDIUM — Forms:** edits are local/form state. Server values stay in the query; display resolves
  edits over server values. Form state does not belong in a global store.
- **MEDIUM — Validation is schema-first.** One schema in a shared module, type derived from it, so
  validation and type cannot drift. Validate at boundaries with a safe-parse API.
- **MEDIUM — Testability is the forcing function.** If you want to test it without rendering,
  define it where no renderer is needed. Pure logic → plain unit tests; hook tests for lifecycle
  behaviour; integration-test the component.

## 4. Constants, utils, types, naming

- **CRITICAL — No dumping grounds.** `utils.ts`, `helpers.ts`, `common.ts` and a single top-level
  `constants.ts` are all the same anti-pattern: the name carries no boundary, so nothing can be
  refused entry. Angular's official guide bans those filenames.
- **CRITICAL — `helpers` has no stable meaning in any source. Don't create the word.** The one
  distinction that recurs in real codebases: **`lib` = configured third-party integrations**
  (API client, SDK setup), **`utils` = your own small pure functions**, as domain-named modules.
- **HIGH — No barrel files inside app code.** Import the file you need. Measured costs: one project
  went from 11k modules and 5–10s dev startup to 3.5k (−68%); Atlassian measured 75% fewer build
  minutes, >30% faster IDE highlighting and 88% fewer tests run per build after removing them.
  Modules behind a barrel load **eagerly** — bundler tree-shaking does not save you, and test
  runners don't tree-shake at all.
  - Never import from your own directory's barrel — that's the classic cycle
    (`tab-panel.ts → index.ts → tab-panel.ts`).
  - At most **one** barrel at a package's or feature's public edge. Never `export *`.
- **HIGH — Name folders by purpose, not by file kind.** FSD states the general rule: "`components`,
  `hooks`, and `types` are bad segment names because they aren't that helpful when you're looking
  for code." Prefer `model`, `api`, `config`.
- **HIGH — Avoid TS `enum` in new code.** Default to a string-literal union; use an `as const`
  object when you need the values at runtime. This is now **mechanical, not stylistic**: Node
  strips types by default since v22.18/v23.6 and *errors* on `enum`, and Node's own recommended
  tsconfig sets `erasableSyntaxOnly: true`. The idiom, value and type sharing one name:
  ```ts
  export const Status = { Pending: "pending", Done: "done" } as const;
  export type Status = (typeof Status)[keyof typeof Status];
  ```
  Never expose an `enum` across an API or serialization boundary — string enums are nominally
  typed, so callers holding a plain string can't pass it. If a codebase keeps enums: string enums
  only, plus `no-unsafe-enum-comparison`.
- **MEDIUM — Extract a function out of a component when** it's pure, closes over nothing, is
  derived data rather than state, you want to unit-test it directly, or a second consumer exists.
  Placement ladder: **module scope in the same file → a domain-named module in the feature → the
  shared layer.** Never straight to a global `utils.ts`.
- **MEDIUM — Constants placement.** A magic value goes at the top of the file that uses it, below
  the imports and outside the component (so it isn't rebuilt per render). A feature `constants.ts`
  appears once several files in that feature share it. Global config holds only app-wide values,
  chiefly env. Name a literal when it **repeats** or isn't legible at the call site — array
  indexes, `0`/`1` and default values don't need names.
- **MEDIUM — `CONSTANT_CASE` means deeply immutable module-level.** A `const` holding a mutable
  array or object stays camelCase; "merely intending to never mutate the object is generally not
  enough."
- **MEDIUM — Types: colocate, promote one level at a time.** One consumer → same file. Several →
  `*.types.ts` at the narrowest enclosing scope. Several packages → a shared package. A global
  `types/` is for framework plumbing only, never the default. Props types live in the component file.
- **MEDIUM — Naming: pick one casing and enforce it with `eslint-plugin-check-file`.** Consistency
  matters more than the choice. Non-component files are camelCase or kebab-case, never PascalCase.
  Prefer named exports over default exports. One concept per file.
- **MEDIUM — Tests colocate** as `Component.test.tsx` beside the source — the mainstream default
  and Vitest's zero-config path.
- **MEDIUM — Rule of three is a floor, not a trigger.** Two copies are fine; at the third you *may*
  extract, and only when the shape is clear. "Duplication is far cheaper than the wrong
  abstraction." When a util grows flags that select per-caller behaviour, **inline it back and
  re-derive** — don't add another flag.

## 5. Next.js App Router architecture

**Version discipline first.** Check the installed Next version before applying any rule here. Rules
tagged **[v16]** do not exist on 15.x. This repo is on **15.5.19**. Async
`params`/`searchParams`/`cookies()` already apply in 15.

- **CRITICAL — `app/` is a routing adapter, not the application.** Route files compose; they don't
  hold business logic. Colocation inside `app/` is safe by default — a segment isn't public until
  `page`/`route` exists — so route-private UI belongs in `_components/`, and anything two routes
  need moves to the shared layer. Next.js is explicitly **unopinionated** about the layout: "choose
  a strategy that works for you and your team and be consistent."
- **CRITICAL — Data access lives in a server-only module, not in `page.tsx`.** For new projects the
  official recommendation is a Data Access Layer that: "Only run[s] on the server. Perform[s]
  authorization checks. Return[s] safe, minimal Data Transfer Objects (DTOs)." Only the DAL reads
  `process.env`. Never hand a DB row to a Client Component. Mark every such module
  `import 'server-only'` — the one enforcement the compiler applies at the boundary that matters.
- **CRITICAL — Every Server Action is a public POST endpoint.** "Render-time gating (only rendering
  a form on an authenticated page) is not a security boundary." Each action authenticates,
  authorizes *the specific resource*, validates input, and constrains its return value. **Schema
  validation is not authorization:** accept an ID plus the user's change and re-read the rest from a
  trusted source using the session — "A well-formed `Item` object can still refer to a row the
  caller does not own." Keep actions thin wrappers over the DAL.
- **CRITICAL — Never gate a route in a layout.** Layouts don't re-render on navigation, and "A
  layout also does not control whether the rest of the route renders… a layout that hides or swaps
  them does not stop them from running or from appearing in the RSC Payload." Auth authority ranks
  **DAL/data-source > page/leaf > layout > proxy/middleware**; middleware is optimistic UX only
  (CVE-2025-29927 is the empirical argument). Re-check in every action and route handler.
- **CRITICAL — Never use a conditional parallel-route slot as authorization.** "Both slots render on
  the server, regardless of which one the layout returns."
- **HIGH — `'use client'` goes on leaf entry points.** The directive marks a module *and every
  transitive import* as client code, so boundary placement is an architectural decision. Two
  crossing rules: "**Code** crosses through imports… **Data** crosses through props, and it must be
  serializable." Pass server-rendered output into client shells as `children` — the client component
  is then the *parent* but not the *owner*. Render providers as deep as possible. Wrap third-party
  client-only libraries in your own `'use client'` file instead of converting your tree.
- **HIGH — Layouts are shells, by framework constraint.** They don't re-render, can't read
  `searchParams` or `pathname`, and "Layouts cannot pass data to their `children`." Uncached runtime
  data in a layout must move to `page.js` or get its own `<Suspense>`, because `loading.js` doesn't
  wrap the layout in its own segment.
- **HIGH — Each segment owns its failure.** `error.tsx` at the level that can still render something
  useful; `global-error.tsx` for the root layout, because `error.js` "does **not** wrap the
  `layout.js` or `template.js` above it in the same segment" — and it needs its own `<html>`/`<body>`
  and styles. Root `not-found.tsx` also catches unmatched URLs.
- **HIGH — Push request-scoped reads downward.** "If you `await` any of these at the top of a layout
  or page, everything below that point becomes dynamic" — pass the promise down and resolve inside
  `<Suspense>`. Cookie *reads* work anywhere on the server; *writes* only in a Server Function or
  Route Handler, which is why mutations can't live in render.
- **HIGH — Don't call your own Route Handlers from Server Components.** "Fetch data in Server
  Components directly from its source" — via-handler fetching fails prerendering and adds a round
  trip. Route Handlers are for real public HTTP surface (webhooks, callbacks, non-HTML content
  types, third-party clients). Server Actions mutate and are **queued** — not a fetch layer.
- **MEDIUM — Route groups are for layout topology and ownership, never URLs.** Two groups resolving
  to one path is an error. The full-page-reload penalty applies **only** to multiple root layouts.
- **MEDIUM — `template.tsx` only to force a remount** per navigation; otherwise use `layout.tsx`.
- **MEDIUM — Parallel and intercepting routes are narrow, high-cost tools** for slot dashboards and
  shareable-URL modals. `(..)` counts **route segments, not folders**, and ignores `@slot`. A modal
  costs ~4 files. **[v16]** every slot now needs `default.js` or the build fails.
- **MEDIUM — Respect root-level constraints.** `public/`, config and `.env.*` stay at the true root;
  `instrumentation.ts` sits at the root or in `src` beside `app`, never inside `app/`. A stray root
  `app/` **silently shadows** `src/app/`. **[v16]** `proxy.ts` replaces `middleware.ts` (Node-only,
  one per project) — keep `middleware.ts` if you need the Edge runtime.
- **MEDIUM — Architect for the testing seam.** Official guidance: use **e2e over unit tests for
  `async` Server Components**, because tooling doesn't support them. Keep domain logic in plain
  modules so it stays unit-testable without a renderer.
- **MEDIUM — Migrate incrementally.** `app/` and `pages/` are designed to coexist. Per route: move
  the existing export into a `'use client'` component, then add a thin server `page.tsx` that
  fetches and passes props — that seam is also where logic later lifts into a feature module. Cost:
  hard navigation across routers, so group migrated routes.

## Deliberate choices where sources disagree

Four questions have no settled answer. This skill picks one default each; the alternative and its
advocates are in [README.md](README.md) under each section's *Contested* heading.

| Question | This skill's default | Why, and when to deviate |
|---|---|---|
| **Barrel files** | None in app code; at most one at a package/feature public edge | Measured build/test/IDE costs beat the encapsulation benefit, and boundaries can be enforced by lint rules instead of by files. Deviate for a *published* package's entry point |
| **Filename casing** | kebab-case files + PascalCase exports | The newer trend (shadcn, Bulletproof React, Angular) and it avoids case-insensitive-filesystem problems. PascalCase files remain defensible — MUI and react.dev use them. **Consistency outranks this choice** |
| **TS `enum`** | Avoid; union or `as const` | Node's default type stripping errors on `enum`. Google's TS guide dissents and permits plain enums |
| **Layered domain architecture** | Earn it — extract a domain module when rules pass the Framework/Import tests, not up front | Even clean-architecture advocates gate it on project size and lifespan. Adopt formal layers (FSD, hexagonal) for long-lived multi-team products |
| **Is `app/` the whole app or a thin shell?** | Route-private UI colocates in `_components/`; promote to a shared/feature layer on the second consumer | Next.js ranks neither. Vercel's *own* published apps put everything inside `app/`; bulletproof-react and FSD keep it a shell. The choice predicts how much `app/` grows |
| **Route-file re-exports** (`export { Page as default } from '@/features/…'`) | Not by default | A one-line route shim is not a feature-wide barrel, so the measured barrel harm doesn't transfer — but it adds indirection, and route segment config must be re-exported binding by binding. Adopt it only with a formal layer scheme like FSD |
| **Where Server Actions live** | Colocated `actions.ts` next to the domain, thin, over a shared DAL | Community consensus favours colocation ("a global `/actions` folder… usually harms separation of concerns"); centralization is argued for the auth chokepoint. Official examples are themselves inconsistent |

## Enforcement

A convention without a linter is a suggestion. The rules above map to:

| Rule | Tool |
|---|---|
| One-way dependencies, no cross-feature imports | `import/no-restricted-paths` zones |
| No cycles (the usual barrel symptom) | `import/no-cycle` |
| Filename/folder casing | `eslint-plugin-check-file` |
| Component/file size smoke alarms | `max-lines`, `max-lines-per-function`, `sonarjs/cognitive-complexity` |
| Unnamed magic values | `no-magic-numbers` (keep its `ignoreArrayIndexes` / `ignoreDefaultValues` escapes) |
| Enum comparison holes, if enums remain | `@typescript-eslint/no-unsafe-enum-comparison` |
| Dead files/exports/deps | `knip` in CI — remove barrels first, or it can't see unused exports |
| Server code reachable from the client graph | `import 'server-only'` on every DAL module (compiler-enforced at the real boundary) |
| Deny-by-default layers, or banning `next/*` inside domain code | `eslint-plugin-boundaries` v7 (`boundaries/dependencies`), or ESLint core `no-restricted-imports` with `patterns` |
| FSD structure, if you adopt FSD | `steiger` (beta — pin the version if CI gates on it) |

Note for Next projects: `eslint-config-next` does **not** bundle `eslint-plugin-import`, so install it
yourself for boundary zones. **[v16]** `next lint` was removed — run `eslint .`.

---

## In this repo (DevDigest)

`client/AGENTS.md` is authoritative here; follow it even where it differs from the defaults above.
Mappings:

- **Route-private UI** → `src/app/**/_components/<PascalCase>/<PascalCase>.tsx`, colocated with
  `<PascalCase>.test.tsx`, `styles.ts`, `helpers.ts`, `constants.ts`. This *is* the colocation rule.
- **Shared components** → `src/components/<kebab-case>/` with an `index.ts` barrel.
- **Hooks** → `useXxx` in `src/lib/hooks/<domain>.ts`, grouped by domain.
- **All HTTP** → `src/lib/api.ts`; data hooks wrap TanStack Query. This is the "one hook per
  resource" rule already in place.
- **Contracts** → `@devdigest/shared` (Zod). The repo's rule that a schema and its `z.infer` type
  share one name is exactly the schema-first consensus. Remember `client/src/vendor/shared` is a
  **separate vendored copy** that must be mirrored by hand.
- **Business logic** → review logic belongs in `reviewer-core` (pure, no DB/GitHub/filesystem); the
  server gathers inputs and persists. That is the domain-module layer, already extracted.
- **Strings** → `next-intl` via `messages/<locale>/*.json`; no hardcoded copy.
- **Server authority** → secrets only via `LocalSecretsProvider`; never from `AppConfig`, DB or logs.

### Next.js specifics here

This is an App Router app (**Next 15.5.19**) used as a **client SPA**: authority over data lives in
the Fastify API on :3001, all HTTP goes through `src/lib/api.ts`, state through TanStack Query, and
`NEXT_PUBLIC_API_BASE` is compiled into the bundle. That is a deliberate package boundary.

So **most of section 5's server-side rules do not apply here, by design, not by neglect** — there
are no Server Actions, no route handlers, no `middleware.ts`, no `server-only` imports, and the DAL
equivalent *is* the server package. **Do not introduce DB access, secrets, or authorization into
`client/`.** All **[v16]** rules are an upgrade checklist, not current advice.

What *does* apply, in order of value:

1. **No segment owns its failure.** There is no `error.tsx`, `not-found.tsx` or `loading.tsx`
   anywhere in `src/app/` — `src/components/repo-not-found/` does this in userland instead. Adding
   segment-level boundaries is the cheapest real improvement available.
2. **Boundaries are unenforced.** `client/eslint.config.mjs` has no `import/no-restricted-paths`
   zones, so nothing stops one route's `_components` importing another's.
3. **The client graph is wide** — 62 `'use client'` modules including the root `page.tsx`.
   Defensible for an SPA, but don't widen it reflexively in new UI.
4. **The unit-test seam is currently intact** — no async Server Components exist, so tests work
   today. Preserve that rather than assume it.

**Three known deviations** — follow the repo, but know these are deviations, and don't propagate
them into new shared code without a decision:

1. `src/components/<kebab-case>/index.ts` barrels contradict the no-barrel-in-app-code rule. They
   are at least at a feature's *public edge*, which is the defensible form. Never import from a
   sibling through one, and never add a `src/components/index.ts` re-exporting everything.
2. The client mixes casing — PascalCase files in `_components/`, kebab-case folders in
   `src/components/`. Consistent within each location; don't "fix" one half unilaterally.
3. Per-component `helpers.ts` is mandated by `client/AGENTS.md`, though no researched source
   defends the word. Prefer a domain-named module for anything that outgrows one component.

---

## Sources

Every rule traces to [README.md](README.md) — 200+ verified sources with dates and version stamps,
consensus vs contested findings, outdated advice to avoid, and **Do not cite** lists of URLs that
failed verification (including several widely shared ones, and three `feature-sliced.design/blog/*`
posts whose provenance could not be confirmed). Read it before overriding a rule here.

For Next.js rules, every official page cited self-reports **v16.3.5**; check your own version before
applying anything tagged **[v16]**.
