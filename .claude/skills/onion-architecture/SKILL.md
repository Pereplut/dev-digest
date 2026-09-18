---
name: onion-architecture
description: >-
  Onion / ports-and-adapters rules for the DevDigest backend — which ring a file belongs to, what
  each ring may import, and where external systems (Drizzle, octokit, simple-git, openai,
  @anthropic-ai/sdk, ast-grep, p-queue) must sit behind a port. Use when adding or moving a server
  module, route, service, repository or adapter; when wiring a new external system or SDK; when a
  route grows business logic or a DB query; when deciding where logic goes so it stays unit-testable
  without Postgres; or when reviewing server/ layering. Trigger terms: onion architecture, ports and
  adapters, hexagonal, clean architecture, layering, boundaries, dependency rule, repository,
  adapter, DI container, composition root, service layer.
version: 1.0.0
---

# Onion Architecture (backend)

**Placement and direction, not correctness.** This skill answers *"which ring does this belong to,
and what may it import?"* Its siblings answer other questions: `fastify-best-practices` (route
mechanics), `drizzle-orm-patterns` (query shape), `zod` (contract shape), `security` (is it safe).

Scope is `server/` (`@devdigest/api`). `reviewer-core/` is cited as the exemplar core but governed
by its own `AGENTS.md`.

Rules are tagged for consuming agents:
- **CRITICAL** — breaks the dependency rule, or makes code untestable without Postgres
- **HIGH** — removes a test seam or leaks a vendor SDK inward
- **MEDIUM** — consistency and maintenance

Every rule traces to a dated source in [README.md](README.md). Before/after pairs from this
codebase are in [examples.md](examples.md).

---

## Quick lookup

| You are writing… | It goes… |
|---|---|
| An HTTP handler | `modules/<name>/routes.ts` — parse, `getContext`, call the service, set status. Nothing else |
| A DB query | `modules/<name>/repository/<entity>.repo.ts` (or `repository.ts`). The **only** place `drizzle-orm` is imported |
| Orchestration across repo + adapter + job | `modules/<name>/service.ts` |
| A pure transform, rollup or derivation | `modules/<name>/helpers.ts` as a **free function** — no `this`, no DB |
| A call to a third-party SDK | A new adapter in `adapters/<tech>/`, behind a port in `vendor/shared/adapters.ts` |
| A new external system | All five steps in [§6](#6-adding-a-new-external-system). No shortcuts |
| A cross-module row shape | `db/rows.ts` — never import another module's repository |
| Review/prompt/grounding logic | `reviewer-core/`, not here |
| A literal, threshold or job kind | `modules/<name>/constants.ts` |

---

## 1. The dependency rule

> "All coupling is toward the centre." — Palermo
> "Source code dependencies can only point inwards." — Martin

One sentence for this repo: **an outer ring may import an inner ring; an inner ring may never import
an outer one.** Everything below is a consequence.

| Ring | Contains | May import | Must never import |
|---|---|---|---|
| **1 — Domain core** | `reviewer-core/src/**`; pure free functions (`modules/*/helpers.ts`, `pulls/status.ts`, `reviews/findings.ts`) | `@devdigest/shared` contracts, stdlib | Anything else in `server/src`; any SDK; `drizzle-orm` |
| **2 — Ports & contracts** | `vendor/shared/adapters.ts`, `vendor/shared/contracts/**`, `modules/repo-intel/types.ts` | Ring 1 | Any implementation; any SDK; `drizzle-orm` |
| **3 — Application services** | `modules/*/service.ts`, `reviews/run-executor.ts`, `repo-intel/pipeline/**`, `platform/jobs.ts` | Rings 1–2, `Container`, its own `repository/*` | Vendor SDKs (`octokit`, `openai`, `@anthropic-ai/sdk`, `simple-git`, `@ast-grep/napi`), `drizzle-orm` |
| **4 — Infrastructure & transport** | `modules/*/routes.ts`, `adapters/**`, `db/**`, `app.ts`, `server.ts` | Everything inward | Another module's internals; `modules/**` from `adapters/**` or `platform/**` |

The rings are **relaxed, not strict**: ring 4 may call ring 1 directly. A pass-through method that
only forwards to the next ring is a Middle Man smell, not architecture — delete it.

---

## 2. Ring 1 — Domain core

- **CRITICAL — the core takes no side effects.** No DB, no HTTP, no filesystem, no clock reads you
  cannot inject. `reviewer-core/AGENTS.md` states the bar: *"No DB, GitHub, or filesystem. The only
  side effect is the injected `LLMProvider`."* That is the target shape.
- **CRITICAL — review logic belongs in `reviewer-core`.** The server gathers inputs and persists
  results. `platform/prompt.ts`, `platform/grounding.ts` and `platform/structured.ts` are
  intentionally thin re-export shims — do not grow them.
- **HIGH — pure logic is a free function, not a method.** `modules/pulls/status.ts` is the model:
  *"pure — no DB / `this`, so they unit-test cleanly."* Anything reachable only through a service
  constructor is effectively untestable here (see [§7](#7-testing-follows-the-rings)).

## 3. Ring 2 — Ports & contracts

- **CRITICAL — a port is an interface, never an implementation.** `vendor/shared/adapters.ts` says
  it outright: *"ALL external calls go behind these interfaces."*
- **CRITICAL — ports import nothing outward.** Per `vendor/shared/AGENTS.md`: *"Schemas only: no
  runtime logic, no imports from server/client code."*
- **MEDIUM — an interface must earn its keep.** Add one only when it has more than one
  implementation, **or** it inverts a dependency to protect an inner ring, **or** it ships in a
  client library. Every port here clears the bar: each has a real adapter *and* a mock in
  `adapters/mocks.ts`. Do not add speculative interfaces for internal collaborators.

## 4. Ring 3 — Application services

- **CRITICAL — a service never imports a vendor SDK.** Reach external systems through the container:
  `container.git`, `container.secrets`, `await container.github()`, `await container.llm(id)`,
  `container.repoIntel`. If no port exists, add one ([§6](#6-adding-a-new-external-system)) — do not
  import the library.
- **CRITICAL — a service never writes SQL.** Persistence goes through its repository.
  `modules/repos/service.ts` states the contract: *"No HTTP and no raw SQL live here — persistence
  goes through RepoRepository, pure transforms through helpers.ts, literals through constants.ts."*
- **HIGH — row → API DTO mapping happens once, in `helpers.ts`.** `toRepoDto` is the pattern;
  `service.list()` is `rows.map(toRepoDto)`. Do not map inside repository functions.
- **MEDIUM — cross-module reuse goes through the container or `db/rows.ts`**, never by importing
  another module's `service.ts` or `repository.ts`. `container.agentsRepo` and `container.reviewRepo`
  exist precisely so *"consuming modules use `container.agentsRepo` instead of reaching into another
  module's folder."*

## 5. Ring 4 — Infrastructure & transport

- **CRITICAL — `routes.ts` is transport only.** Parse → `getContext` → call the service → set the
  status code. No `drizzle-orm`, no `db/schema.js`, no business logic.
  `modules/repos/routes.ts` is the reference: 48 lines, four routes, zero logic.
- **CRITICAL — `adapters/**` and `platform/**` must not import `modules/**`.** That is an inner ring
  depending on an outer one. Shared constants belong in the adapter, in the port, or in a neutral
  module.
- **HIGH — one adapter per external system, under `adapters/<tech>/`**, implementing its port, with
  timeouts/retries via `platform/resilience.ts` and failures surfaced as `ExternalServiceError`.
- **HIGH — route schemas come from `@devdigest/shared`.** Don't hand-roll `Schema.parse(req.body)`
  in a handler.
- **MEDIUM — repositories may return Drizzle `$inferSelect` rows.** This is a deliberate deviation
  from Clean Architecture — see [§9](#9-deliberate-choices-where-sources-disagree).

---

## 6. Adding a new external system

All five steps, or the system is not integrated — it is smuggled in. ast-grep is the cautionary
example: it skipped every step and is now imported directly by `repo-intel/service.ts` and
`pipeline/full.ts`, with no test seam.

1. **Port** — declare the interface in `vendor/shared/adapters.ts` (or a module-local `types.ts` for
   an internal facade, like `modules/repo-intel/types.ts`).
2. **Adapter** — implement it in `adapters/<tech>/index.ts`. This is the only file allowed to import
   the SDK.
3. **Mock** — add a deterministic implementation to `adapters/mocks.ts`. *"NO real network."*
4. **Container** — add a lazy getter on `Container`, and the matching key to `ContainerOverrides`.
   Use `async` only when the client needs a secret (see the `github()` / `llm()` getters).
5. **Consume** — services use `container.<thing>`. Tests inject through `overrides`.

A degraded-mode contract is strongly preferred where the system is optional: `modules/repo-intel/types.ts`
declares one explicitly (arrays → `[]`, objects → `{ degraded, reason }`) so callers never branch on
absence. `server/INSIGHTS.md` (2026-09-15) records the cost of leaving this implicit: repo-intel
context degrades silently with no error.

## 7. Testing follows the rings

- **HIGH — fake at the port, don't mock the module.** There is no `vi.mock` of application modules
  anywhere in `server/test`, and it should stay that way. Substitute adapters via
  `ContainerOverrides`; the seven mocks in `adapters/mocks.ts` exist for this.
- **HIGH — if logic needs a test, put it in ring 1.** Every service constructor does
  `new XRepository(container.db)`, so a repository cannot be substituted from outside. The single
  service unit test has to monkey-patch a private field
  (`test/repo-intel-facade-degraded.test.ts`) — treat that as a warning, not a pattern. Extract the
  logic to a free function instead.
- **MEDIUM — a test importing `test/helpers/pg.ts` must be named `*.it.test.ts`.** Everything else
  stays hermetic. `routes-smoke.test.ts` boots the whole app with no DB at all — that capability is
  exactly Cockburn's stated goal, and it is worth preserving.

## 8. Transactions

There are **zero** `db.transaction(...)` calls in `server/src` today, so multi-statement writes are
non-atomic — `run.repo.deleteAgentRun` deletes from `reviews` then `agent_runs`, and
`JobRunner.enqueue` performs three to five separate status updates.

When you need atomicity, keep the transaction in the **application** ring and pass it down; do not
let it leak into routes:

```ts
// service.ts — owns the boundary
await this.db.transaction(async (tx) => {
  await deleteReviews(tx, runId);
  await deleteAgentRun(tx, runId);
});

// repository/*.repo.ts — accepts an optional invoker
export async function deleteAgentRun(db: Db | Tx, runId: string) { … }
```

The `tx ?? db` invoker shape is the standard TypeScript treatment; see README §Stack-specific.

---

## 9. Deliberate choices where sources disagree

| Question | This skill's default | Why, and when to deviate |
|---|---|---|
| **Do repositories return DB rows or domain entities?** | **Rows** (`$inferSelect`) | Martin says never pass database rows across a boundary. We overrule him: a separate persistence model can quadruple CRUD code for no gain at this domain complexity (Rentea), and the codebase is already consistent. Revisit if module logic starts depending on row shape in more than one ring |
| **Interface for every collaborator?** | **No** | An interface earns existence with >1 impl, a dependency inversion protecting an inner ring, or a client library. Ports clear this; internal services don't |
| **Where do repositories live — domain or application?** | **Application** | Palermo puts repository *interfaces* in the core; Graça argues persistence is an application concern because *"the domain knows nothing about persistence."* We follow Graça: the port lives in ring 2, the implementation in ring 4 |
| **Strict or relaxed layers?** | **Relaxed** | A method that only forwards to the next layer is a Middle Man. Skipping a ring inward is fine; skipping outward never is |
| **Per-module layers, or flat vertical slices?** | **Layers, in modules with a service** | The module boundary already separates features (Jovanović), so layers are earned, not automatic — but shared entities across use cases make a dedicated data layer worth it here |
| **DI container required?** | **No, but use the one we have** | Palermo, four years on: onion *"works just fine without the likes of StructureMap."* `Container` is a hand-rolled composition root, and that is sufficient |

---

## 10. Enforcement

A convention without a linter is a suggestion. `server/INSIGHTS.md` (2026-09-18) records an entire
unregistered module with hardcoded secrets and `sql.raw` concatenation passing typecheck, lint and
all 103 tests untouched — prose alone does not hold here.

| Rule | Tool |
|---|---|
| Ring direction, `routes.ts` free of Drizzle, no SDK in services, no cycles | `server/.dependency-cruiser.cjs` → `pnpm arch` |
| Same rules, in-editor while typing | ESLint `no-restricted-imports` zones in `server/eslint.config.mjs` |
| Anything an import graph can't express | `@ast-grep/napi` (already a dependency) |
| Richer layer algebra, if zones outgrow the core rule | `eslint-plugin-boundaries` v7 |

Both tools run from `pnpm lint`. dependency-cruiser exits with the violation count, so CI gates for
free. Two options are load-bearing in that config: `tsConfig` (without it the `@devdigest/shared`
and `../reviewer-core/src` path aliases don't resolve and the ruleset silently under-reports) and
`tsPreCompilationDeps` (without it `import type { Container }` coupling is invisible).

**A ruleset that never fails is the failure mode.** After changing it, drop one exclusion and
confirm the rule actually fires.

---

## 11. In this repo (DevDigest)

`server/AGENTS.md` is authoritative; follow it where it differs. What already exists and should be
used rather than reinvented:

- **Ports** → `src/vendor/shared/adapters.ts` (`LLMProvider`, `GitHubClient`, `GitClient`,
  `CodeIndex`, `Embedder`, `AuthProvider`, `SecretsProvider`), plus `DepGraph` and `Tokenizer`
  declared beside their adapters.
- **Adapters** → `src/adapters/<tech>/`. Mocks → `src/adapters/mocks.ts`.
- **Composition root** → `src/app.ts` (`buildApp`), which constructs one `Container` per instance
  and decorates Fastify with it. Tests call `buildApp({ config, db, overrides })`.
- **Container** → `src/platform/container.ts`.
- **Reference module** → `modules/repos/` (`routes.ts` → `service.ts` → `repository.ts` +
  `helpers.ts` + `constants.ts`). Copy this shape.
- **Exemplar core** → `reviewer-core/`, consumed as source via path alias.
- **Secrets** → only via `LocalSecretsProvider`; never from `AppConfig`, DB or logs.

### Known deviations — do not copy these

They are excluded by name in `.dependency-cruiser.cjs`, each with a comment. New and touched code is
held to the rule.

1. **`polling`, `workspace` and `settings` have no service and no repository** — each runs Drizzle
   inline from `routes.ts`, and `settings/feature-models.ts` queries `container.db` from a plain
   helper. **Three of eight modules.** A new route gets one.
   `pulls` was the worst case (402 lines, ~20 inline queries interleaved with GitHub calls, a
   diff-stat backfill and two rollups) and was extracted into `service.ts` +
   `repository/pull.repo.ts` + `helpers.ts`, keeping the already-pure `status.ts`. Both of its
   exclusions were deleted from `.dependency-cruiser.cjs`, so the rules now hold it.
2. **`adapters/astgrep/index.ts:25` and `adapters/depgraph/index.ts:20` import
   `modules/repo-intel/constants.js`** — ring 4 reaching into a feature module.
   `adapters/auth/local.ts` additionally runs Drizzle queries and imports from `db/seed.ts`.
3. **`platform/container.ts` imports three feature modules**, and `RepoIntelService` imports
   `Container` back — a cycle the composition root gets a pass on, nothing else does.
4. **`p-queue` and `graphology` are imported directly** by the indexer pipeline, so neither can be
   substituted in a test. ast-grep no longer belongs on this list: it got the `CodeParser` port
   (`adapters/astgrep/port.ts`), `MockCodeParser`, and `container.codeParser`, enforced by the
   `astgrep-only-through-its-port` rule — §6 above still cites it as the cautionary example of what
   skipping those steps costs.
5. **No route declares a `response:` schema**, so the shared Zod contracts validate inputs only;
   handler return shapes are guaranteed by `tsc`, not at runtime.
6. **Repositories return two different kinds of thing** — mostly rows, but `run.repo.ts` and
   `pull.repo.ts` return mapped snake_case contract DTOs (`RunSummary`, `Intent`, `RunTrace`).
   Prefer the `helpers.ts` mapping for new code.

---

## Sources

Every rule traces to [README.md](README.md), with dates, verified links, and the consensus/contested
split. Read it before overriding anything here.

The four load-bearing ones: Palermo (the dependency rule), Cockburn (ports and adapters), Martin
(the Dependency Rule verbatim — and the one rule this skill knowingly relaxes), and Rentea (why the
relaxation is correct at this domain complexity).
