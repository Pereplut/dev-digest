# Development Plan — spec 0020 (Eval compare)

## Task
Build the per-agent eval dashboard content and the compare-two-runs modal inside the existing Evals tab, plus the three server routes (`eval-dashboard`, `eval-runs/compare`, `versions/:version/promote`) and the `metrics_version` stamp that makes a cross-formula delta refusable.

## Requirements source
| Governing spec | `status:` (`path:line`) | Criteria it defines | Rows in my review |
|---|---|---|---|
| `/home/komp/dev-digest/specs/0020-eval-compare.md` | `status: approved` (`specs/0020-eval-compare.md:3`) | 81 (AC-1 … AC-81) | 81 |

Counts match. Four things the user settled directly and the spec already absorbed (scope = per-agent view + compare modal; the Evals tab as host with `nav.ts` untouched; promote = restore `config_json` as a new version behind a confirmation; alert threshold a fixed `-0.02`; the per-row drill-down) are carried as the spec's own criteria, not as separate rows, because `## Decisions` (`:108-115`) records each one with its criterion. One request of the user's is **not** a criterion anywhere: *"flag any verified fact you find to be wrong"* — discharged in `## Constraints` C14 and `## Recommendations` P1/P6, not as a step.

## Requirements review
| ID | Requirement, restated in one sentence | Source | Verdict | Satisfied by |
|---|---|---|---|---|
| R1 | `eval_run_batches` gains a NOT NULL integer `metrics_version` defaulting to the current formula's constant | `:135 (AC-1)` | clear | S3, S5 |
| R2 | The migration adding the column leaves every pre-existing row at `1` | `:137 (AC-2)` | clear (mechanism restated: a column added with `DEFAULT 1` in S4, then a second generated migration flipping the default to `2` in S5 — a generated `DEFAULT 2` add would stamp history `2`, and the migration may not be hand-edited) | S4, S5 |
| R3 | A new batch row is stamped with the one exported constant that names the rollup formula | `:139 (AC-3)` | clear (placement restated: `EvalService.queueBatch` → `insertQueued`, the only writer of a *new* batch row; `run-executor.ts` only updates an existing one) | S3, S6 |
| R4 | `EvalBatchRecord` carries `metrics_version` as an integer, additively | `:146 (AC-4)` | clear | S1, S2 |
| R5 | `EvalTrendPoint`'s three metrics become `z.number().nullable()` | `:147 (AC-5)` | clear | S1, S2 |
| R6 | `EvalDashboard.current.*` and `.delta.*` metrics become nullable | `:149 (AC-6)` | clear | S1, S2 |
| R7 | `EvalDashboard.recent_runs` becomes `EvalBatchRecord[]` | `:152 (AC-7)` | clear | S1, S2 |
| R8 | `EvalRunComparison` is exported from `contracts/eval-ci.ts` through the barrel with old/new, both configs, `comparable`, `incomparable_reason`, four deltas | `:155 (AC-8)` | clear (both barrels are `export * from './contracts/eval-ci.js'` — `server/src/vendor/shared/index.ts:24`, `client/src/vendor/shared/index.ts:24` — so "through the barrel" needs no index edit) | S1, S2 |
| R9 | `EvalPromoteResult` is exported, carrying `agent`, `version`, `skills_not_restored` | `:159 (AC-9)` | clear | S1, S2 |
| R10 | The client contract copy mirrors R4–R9 with identical names/types and no unrelated change | `:161 (AC-10)` | clear | S2 |
| R11 | `GET /agents/:id/eval-dashboard` → `200` `EvalDashboard`, `owner_kind: 'agent'`, scoped to workspace + agent | `:166 (AC-11)` | clear | S9, S10 |
| R12 | `current` comes from the latest `done` batch, with `traces_*` from `cases_passed`/`cases_total` | `:169 (AC-12)` | clear (`traces_passed`/`traces_total` stay non-nullable ints — AC-6 nullifies only the three metrics — so the no-batch case is `0`/`0`) | S7, S9 |
| R13 | Each delta = current minus the most recent *earlier* `done` batch of the **same** `metrics_version` | `:172 (AC-13)` | clear | S7 |
| R14 | `trend` = one point per `done` batch of the current batch's `metrics_version`, `ran_at` ascending, 20 most recent | `:174 (AC-14)` | clear | S7 |
| R15 | `recent_runs` = the 10 most recent batches of any status, `ran_at` descending | `:177 (AC-15)` | clear | S7, S9 |
| R16 | A delta `≤ -0.02` sets `alert` to the lowest-delta metric's stable code, else `null` | `:179 (AC-16)` | clear (two restatements: the named constant lives in `modules/evals/constants.ts` and is consumed by the pure helper, which is the only place the arithmetic is testable — AC-16 says "in the dashboard service"; and a tie between two equal deltas resolves in the fixed order recall → precision → citation, which AC-16 does not specify) | S7 |
| R17 | A `null` operand, or no earlier same-version `done` batch, makes that delta `null`, never `0` | `:183 (AC-17)` | clear | S7 |
| R18 | No `done` batch → `200` with all metrics `null`, `trend` empty, `alert` `null`, `cases_total` = the agent's case count | `:186 (AC-18)` | clear | S7, S9 |
| R19 | An unknown or foreign-workspace `:id` → `404 not_found` | `:189 (AC-19)` | clear | S9 |
| R20 | `GET /agents/:id/eval-runs/compare` with two ids → `200`, `old` = earlier `ran_at`, regardless of argument order | `:194 (AC-20)` | clear (transport unspecified by the spec and settled here: two named query params `a` and `b`, each `z.string().uuid()` — a repeated key is a bare string on one occurrence and an array only on the second, `server/INSIGHTS.md:349-355`) | S7, S9, S10 |
| R21 | An unknown / foreign-agent / foreign-workspace batch id → `404 not_found` | `:197 (AC-21)` | clear | S8, S9 |
| R22 | Two equal ids → `422 validation_error` | `:199 (AC-22)` | clear | S9 |
| R23 | A non-`done` batch on either side → `422` naming the offending status | `:201 (AC-23)` | clear | S9 |
| R24 | Differing `metrics_version` → `comparable: false` + a stable `incomparable_reason` code | `:203 (AC-24)` | clear | S7 |
| R25 | While incomparable, the three metric deltas are `null` and `delta.cost_usd` is still computed | `:205 (AC-25)` | clear | S7 |
| R26 | `old_config`/`new_config` come from the `agent_versions` snapshot for each batch's `(agent_id, agent_version)`, `null` when absent | `:208 (AC-26)` | clear (residual: a snapshot that exists but fails `AgentVersionConfig.parse` is unmodelled — see P6) | S9 |
| R27 | The compare response carries no `actual_output` and no finding payload | `:211 (AC-27)` | clear | S1, S9 |
| R28 | A successful promote writes the snapshot's seven config fields onto the agent, bumps `version` by one and inserts a snapshot for the new version | `:216 (AC-28)` | clear (ordering restated: links must be restored **inside the same transaction and before** the snapshot insert, or the new snapshot records the pre-promote skill set — `repository.ts:168-187` builds `config_json.skills` from `skillIdsForAgent` at snapshot time) | S12, S13 |
| R29 | Promote leaves `name`, `description`, `enabled` untouched | `:220 (AC-29)` | clear | S12 |
| R30 | Promote enables exactly the snapshot's skill ids and disables every other link row of that agent | `:223 (AC-30)` | clear (known imprecision: `skillIdsForAgent` also filters `skills.enabled` (`repository.ts:225-239`), so a globally-disabled skill in the snapshot is linked-enabled yet absent from the *new* snapshot — see P5) | S12, S13 |
| R31 | A snapshot skill with no link row but a live skill row gets an enabled link appended after the existing ones | `:226 (AC-31)` | clear | S12 |
| R32 | A snapshot skill whose skill row is gone is skipped, reported in `skills_not_restored`, and does not block the rest | `:229 (AC-32)` | clear | S12, S13 |
| R33 | `:version` equal to the agent's current `version` → `409 conflict`, no row changed | `:232 (AC-33)` | clear | S13 |
| R34 | A `queued`/`running` `eval_run_batches` row for that agent → `409 conflict`, no row changed | `:234 (AC-34)` | clear (the cross-module read is the plan's layering call — see `## Decisions I settled` #1) | S8, S11, S13 |
| R35 | A `:version` with no snapshot → `404 not_found` | `:237 (AC-35)` | clear | S13 |
| R36 | Success → `200` `EvalPromoteResult` whose `agent.version` is the new version | `:239 (AC-36)` | clear | S13, S14 |
| R37 | The tab renders three metric tiles, each with value and delta | `:250 (AC-37)` | clear | S22 |
| R38 | A `null` current metric renders the `evals` placeholder via `formatRatioTile`, never `NaN`/`null`/`0%` | `:252 (AC-38)` | clear | S22 |
| R39 | A `null` delta renders the placeholder and no direction indicator | `:255 (AC-39)` | clear | S18, S22 |
| R40 | Delta direction is conveyed in text as well as colour | `:258 (AC-40)` | clear | S18, S22 |
| R41 | A non-null `alert` renders an i18n banner built from the code and the deltas; `null` renders none | `:259 (AC-41)` | clear | S22, S23 |
| R42 | The trend renders through the vendored `LineChart` with three index-aligned, equal-length series built by a pure tab helper | `:262 (AC-42)` | clear | S18, S22 |
| R43 | A point with any `null` metric is dropped from **all three** series | `:266 (AC-43)` | clear | S18 |
| R44 | Every series element satisfies `Number.isFinite`; no `null`/`undefined` reaches the primitive | `:268 (AC-66)` | clear | S18 |
| R45 | `yMin={0}` and `yMax={1}` are passed explicitly | `:271 (AC-67)` | clear | S22 |
| R46 | Fewer than two plottable points → an i18n empty state instead of the chart | `:273 (AC-44)` | clear | S18, S22 |
| R47 | A note names, separately, how many `done` batches the trend excluded for an older `metrics_version` and how many for an incomplete metric triple | `:276 (AC-45)` | **contradicted by repo/contract** — the counts are not derivable from the payload AC-5–AC-7 define: `trend` holds only *included* points (`:174`) and `recent_runs` is capped at 10 of any status (`:177`), so an agent with more than 10 batches, or with excluded ones outside the newest 10, cannot be counted client-side. The server has the rows; no contract field carries the result (`eval-ci.ts:68-88`) | **Q1** · S7, S22 (on the default) |
| R48 | One recent-runs row per entry, carrying `ran_at`, version, three metrics, passed-of-total and cost | `:278 (AC-46)` | clear | S19 |
| R49 | A selection checkbox on `done` rows only | `:282 (AC-47)` | clear | S19 |
| R50 | Compare is disabled unless exactly two rows are selected | `:283 (AC-48)` | clear | S19, S22 |
| R51 | At two selections every unselected checkbox is disabled | `:285 (AC-49)` | clear | S19 |
| R52 | Activating Compare issues one `GET …/compare` for the two ids and opens the modal | `:290 (AC-50)` | clear | S17, S22 |
| R53 | The modal title carries both version numbers old→new, through `next-intl` | `:292 (AC-51)` | clear | S20, S23 |
| R54 | Four tiles show old, new and signed delta, cost via `formatCostTile` | `:294 (AC-52)` | clear | S20 |
| R55 | A `null` side renders the placeholder and placeholders that tile's delta | `:297 (AC-53)` | clear | S20 |
| R56 | Incomparable → a warning naming the reason, three placeholder deltas, a rendered cost delta | `:299 (AC-54)` | clear | S20, S23 |
| R57 | The prompt diff uses the **existing** `toDiffRows`, with no second implementation | `:302 (AC-55)` | clear | S16, S20 |
| R58 | `toDiffRows`/`DiffRow`/`DiffKind` move to one module under `client/src/lib/`, imported by both consumers, with `VersionsTab`'s output unchanged | `:307 (AC-68)` | clear (filename settled: `client/src/lib/text-diff.ts` — see `## Decisions I settled` #3) | S16 |
| R59 | Each diff line carries a text marker as well as a background colour | `:311 (AC-56)` | clear | S20 |
| R60 | Both prompts render as plain text, no markdown, no HTML | `:313 (AC-57)` | clear | S20 |
| R61 | A `null` config renders a notice in place of the diff block, with the four tiles still rendered | `:315 (AC-58)` | clear | S20 |
| R62 | Identical prompts render a "no prompt change" message | `:317 (AC-59)` | clear | S20 |
| R63 | The promote control is labelled with the **new** batch's version | `:319 (AC-60)` | clear | S20 |
| R64 | If the new batch's version is already current, promote is disabled with a reason in text | `:321 (AC-61)` | clear | S20 |
| R65 | Activating promote renders a confirmation naming the version, the snapshot's `model` and the count of skills left enabled | `:323 (AC-69)` | clear (rendered as a second *step inside the same* `Modal`, not a stacked one — `getByRole("dialog")` throws on two matches, which is exactly the query AC-69's test plan prescribes; see `## Decisions I settled` #2) | S20 |
| R66 | While the confirmation is unanswered, no promote request is issued | `:327 (AC-70)` | clear | S20 |
| R67 | Dismissal issues no request and changes no version or snapshot count | `:329 (AC-71)` | clear | S20 |
| R68 | Acceptance issues exactly one `POST …/promote` | `:331 (AC-72)` | clear | S17, S20 |
| R69 | Success renders an i18n confirmation and the tab refetches the agent and the dashboard | `:333 (AC-62)` | clear | S17, S20 |
| R70 | Failure renders `error.message` inline and the modal stays open | `:335 (AC-63)` | clear | S20 |
| R71 | `Escape` closes the compare modal and returns focus to the Compare control | `:337 (AC-64)` | clear (the caller must own it: the vendored `Modal` (`client/src/vendor/ui/kit/Modal.tsx:19-68`) has **no** keydown handler, no focus trap and no focus restore — only a backdrop `onClick`. Focus *trapping*, which `## Non-functional` (`:450`) also claims, is **not** implementable without editing vendored UI — see C12 and `## Out of scope`) | S22 |
| R72 | Every row carries, in its own trailing cell, a `<button>` opening that batch's case detail; the row is not a click target and has no `role="button"` | `:342 (AC-73)` | clear | S19 |
| R73 | Activating it issues one `GET /eval-runs/:batchId` for that row's batch and opens the dialog | `:345 (AC-74)` | clear | S17, S21, S22 |
| R74 | One dialog row per `runs` entry with case name, pass state as text, and the three metrics | `:347 (AC-75)` | clear | S21 |
| R75 | While in flight the dialog shows a `role="status"` indicator with an explicit `aria-label` | `:350 (AC-76)` | clear | S21 |
| R76 | On failure the dialog shows `error.message` plus retry and stays open | `:352 (AC-77)` | clear | S21 |
| R77 | Empty `runs` → an i18n empty state | `:354 (AC-78)` | clear | S21 |
| R78 | `runs.length < batch.cases_total` → a note naming the difference as cases deleted since the sweep | `:356 (AC-79)` | clear | S21 |
| R79 | A `null` `case_name` renders the placeholder, never `null` or an empty cell | `:358 (AC-80)` | clear | S21 |
| R80 | The dialog renders no part of `actual_output` and no finding text | `:360 (AC-81)` | clear | S21, S24 |
| R81 | Every user-facing string resolves through `next-intl` from the existing `evals.json`, with no new namespace | `:366 (AC-65)` | clear | S23, S24 |

**Under-planning check:** 80 of 81 are `clear` and each names at least one step. One (R47/AC-45) is contradicted and blocked on Q1; nothing is in `## Out of scope` unsatisfied.

## Scope
| Package | What changes | Why |
|---|---|---|
| `server/src/vendor/shared/` | `contracts/eval-ci.ts` only (no `index.ts` edit — it is `export *`, `:24`) | R4–R9 |
| `client/src/vendor/shared/` | `contracts/eval-ci.ts` mirror | R10 |
| `server/` | `db/schema/eval.ts`, **two** generated migrations, `modules/evals/{constants,helpers,service,routes}.ts` + `repository/eval-batch.repo.ts`, `modules/agents/{repository,service,routes}.ts`, `platform/container.ts` | R1–R3, R11–R36 |
| `client/` | `src/lib/text-diff.ts` (new), `src/lib/hooks/{evals,agents}.ts`, the `EvalsTab/` tree + three new `_components/`, `skills/.../VersionsTab/{helpers,VersionsTab}.tsx`, `messages/en/evals.json` | R10, R37–R81 |
| `reviewer-core/`, `mcp/`, `e2e/` | none | 0020 makes no model call (`:374`) and adds no tool or flow |

## Constraints
| Constraint | Source (`path:line`) | How this plan honors it |
|---|---|---|
| C1 — Never hand-edit, rename or reorder a migration; a schema change is `schema/` + `pnpm db:generate` + `pnpm db:migrate` | root `AGENTS.md` "Do not touch" | S4 and S5 are *generate* steps; the only hand-written SQL-adjacent edit is `schema/eval.ts`. The latest migration today is `0022_chemical_harrier.sql`, so expect `0023_*` and `0024_*` |
| C2 — A single generate that both adds and drops/renames blocks on a TTY prompt | `server/INSIGHTS.md:231-238` | S4 adds only; S5 changes one default only. Read each emitted `.sql` **before** migrating; if S5's generate produces anything other than an `ALTER COLUMN … SET DEFAULT`, stop and ask rather than edit |
| C3 — `text(col,{enum})` adds no DB `CHECK`; `metrics_version` is an integer, so only Zod and TS narrow it | `server/INSIGHTS.md:515-521` | No schema-level test asserts an invalid `metrics_version` is rejected; R4's enforcement is the contract test |
| C4 — Drizzle 0.38 `numeric()` is always a string; convert at the repository boundary | `server/INSIGHTS.md:144-150`; `db/schema/eval.ts:111-115` | `cost_usd` keeps `Number()` on read; the cost **delta** is a display-only subtraction of two already-converted numbers and is never persisted (spec `:472-474`) |
| C5 — `drizzle-orm` only in `modules/*/repository/**` | `.dependency-cruiser.cjs:34-44` | Only S8 and S12 touch drizzle; S7's helpers, S9/S13's services and S10/S14's routes do not |
| C6 — A module may not import a sibling's `service.ts` or `repository/**`; `tsPreCompilationDeps: true` catches type-only imports too | `.dependency-cruiser.cjs:88-97`; `server/INSIGHTS.md:473-479` | The AC-34 read goes through a **container getter**, the escape that rule's own comment names (`:91`). `modules/agents/` imports nothing from `modules/evals/` |
| C7 — `helpers.ts` is this repo's *pure* extension point and the arch rules classify by filename | `server/INSIGHTS.md:473-479`, `:547-553` | S7 puts all dashboard/compare arithmetic in `modules/evals/helpers.ts` with zero I/O; the threshold constant goes in `constants.ts`, which imports nothing (`constants.ts:1-15`) |
| C8 — A cast-based `Container` stub satisfies the type and still throws when a new dependency is read; a new repository method breaks hand-rolled stubs invisibly | `server/INSIGHTS.md:114-120`, `:150-155` | S11 adds a getter and S8 adds two methods, so S15 must widen `server/test/agents-versions.it.test.ts`'s cast stub (it is one of eight files using `as Container`) |
| C9 — `hasLiveBatch` is keyed on `owner_id`, not `agent_id` | `repository/eval-batch.repo.ts:174-180`; `db/schema/eval.ts:90-96` | S8 adds `hasLiveBatchForAgent(agentId)` predicated on the `agent_id` column, so AC-34 survives the skill-owned batch the schema comment anticipates |
| C10 — `client/src/vendor/ui/**` is "Do not touch"; `review_scope.py` raises an undowngradable repo-rule CRITICAL there, and the directory is `skip` in `skill-map.json:12` | root `AGENTS.md`; spec `:386`, `:458-462` | Every accommodation is in the caller: S18 drops null points, S22 passes `yMin`/`yMax`. No file under `client/src/vendor/` appears in the diff |
| C11 — `LineChart` coerces a missing point to `0` and defaults `yMin` to `0.6` | `client/src/vendor/ui/charts/LineChart.tsx:15,22,35` | R43/R44/R45 |
| C12 — The vendored `Modal` has no Escape handler, no focus trap and no focus restore; its title is a plain `div` | `client/src/vendor/ui/kit/Modal.tsx:19-68`; `client/INSIGHTS.md:120-123` | S22 adds a `window` keydown listener and a focus-restore ref (precedent: `AddRepoView.tsx:25-31`); every modal title is queried **by text**, never `getByRole("heading")`. Focus trapping is out of scope |
| C13 — A wrapper control concatenates its descendants' accessible names; the vendored `Chip` is always a `<button>` | `client/INSIGHTS.md:126-132`, `:175-181` | R72: the detail affordance is a plain `<button>` in its own cell, status is a `Badge` (a `<span>`), and tests query by **exact** accessible name |
| C14 — **A verified fact I found to be half-true:** the old batch metrics are not uniformly "mean-of-per-case" — `citation_accuracy` is *still* a per-case mean today (`meanRatio`), only `recall`/`precision` became pooled | `server/INSIGHTS.md:571-583`; `modules/evals/helpers.ts:103-133` | Nothing in the plan changes: `metrics_version` stamps the *batch formula set* as a whole, which is what AC-1–AC-3 require. But the spec's prose at `:41-49` ("pooled, expectation-denominated metrics") over-generalises to all three metrics — recorded in P1 so a later reader does not re-derive it |
| C15 — `role="status"` takes its accessible name only from `aria-label`/`aria-labelledby`, even in jsdom | `client/INSIGHTS.md:144-151` | R75's element carries both the role and an explicit `aria-label` |
| C16 — A **value** import from `@devdigest/shared` passes typecheck and vitest and breaks `next dev`/`next build` | `client/INSIGHTS.md:83-89` | Every new client import of a 0020 contract is `import type`; S24 asserts it on the source text |
| C17 — Every `messages/en/*.json` ships to every route | `client/INSIGHTS.md:52-58` | S23 adds keys to the existing `evals.json`; no new file |
| C18 — Adding a data hook to a shared component crashes unrelated test files that render it without a provider | `client/INSIGHTS.md:206-211` | S19–S21 are new leaf components rendered only by `EvalsTab`, so the blast radius is `EvalsTab.test.tsx`; S16's move adds no hook to `VersionsTab` |
| C19 — A tab whose components test green can still be unreachable through `?tab=` | `client/INSIGHTS.md:212-217` | Already fixed in `dc86fab`; 0020 adds no tab and must not re-inline a tab allowlist |
| C20 — Parallel agents share one working directory and must not co-run a package's suite | root `INSIGHTS.md:76-83` | The waves below are disjoint by package and never co-run a suite |
| C21 — A server test importing `test/helpers/pg.ts` must be named `*.it.test.ts`; nobody in the agent chain runs that lane | `server/AGENTS.md`; root `INSIGHTS.md:304-310` | Every DB-backed test below is `.it.test.ts` and is listed as **the user's** to run in `## Verification` |
| C22 — `EvalTrendPoint.pass_rate` is non-nullable and Zod rejects `NaN` | `eval-ci.ts:62` | S7 computes `cases_total > 0 ? passed/total : 0`; `cases_total ≥ 1` holds today only because 0019 AC-33 refuses an empty sweep |

## Decisions I settled

**1. The AC-34 cross-module read (R34) — a container repository getter, not a new port.**
`AgentsService.promote` (ring 3) must know whether a sweep is live for the agent. The dependency-cruiser rule that forbids reaching into `modules/evals/repository/**` names its own escape hatch in its comment: *"Use the container (container.agentsRepo, container.reviewRepo)"* (`.dependency-cruiser.cjs:88-97`). That escape already has three instances — `agentsRepo`, `reviewRepo`, `skillsRepo` (`container.ts:109-120`) — and `EvalService` itself consumes `container.agentsRepo` in the opposite direction (`modules/evals/service.ts:196`).

So:
- `EvalBatchRepository.hasLiveBatchForAgent(agentId): Promise<boolean>` — **ring 4**, `modules/evals/repository/eval-batch.repo.ts`, the only ring allowed to hold drizzle (C5), predicated on the `agent_id` column rather than `owner_id` (C9).
- `Container.evalBatchRepo` — **ring 4 composition root**, `platform/container.ts`, exempt from `platform-no-modules` (`:84`) and from `no-circular` via `viaOnly.pathNot` (`:128`).
- `AgentsService.promote` — **ring 3** — calls `this.container.evalBatchRepo.hasLiveBatchForAgent(id)` and **imports no evals type**, so `tsPreCompilationDeps` has nothing to trip on.

**Why not a port in `vendor/shared/adapters.ts` (ring 2).** The onion skill reserves ports for *external systems* reached through a vendor SDK (`.dependency-cruiser.cjs:27-28`, "`service-no-sdk`"). Eval liveness is one `SELECT` on a table this repo owns; a port would add a ring-2 interface, a container wiring and a stub obligation for a boolean, and would be the only port in the codebase fronting a local table. I name it as the rejected alternative explicitly because `architecture-reviewer` will ask: the test is "is there an external system behind this?", and there is not. Cost of being wrong: the swap is one interface and one getter annotation, with no call-site change.

**2. Two dialogs at once — no. One `role="dialog"` at a time, and the promote confirmation is a *step inside* the compare modal.**
Read of the vendored `Modal` (`client/src/vendor/ui/kit/Modal.tsx`): it is a `position: fixed` overlay at `zIndex: 50` with `role="dialog" aria-modal="true"` and **no** stacking context, focus trap or keydown handling. Two mounted at once means two elements with `role="dialog"` — and `getByRole("dialog")` *throws* on multiple matches, which is precisely the query AC-51's, AC-69's and the case-detail tests are told to use (`:549`, `:556`). So:
- `EvalsTab` holds a **single-slot** dialog state (`{ kind: "none" | "runConfirm" | "compare" | "caseDetail"; … }`). The run-confirm modal 0019 already renders joins that slot. The compare modal covers the recent-runs table anyway, so no row control is reachable behind it.
- The promote confirmation (AC-69–AC-72) renders **inside the already-open compare modal** as a replacement body + footer, keeping exactly one dialog and one focus context. It is not a stacked `Modal`.

**3. The promoted diff module's filename: `client/src/lib/text-diff.ts`.**
`client/src/lib/` holds flat, single-purpose modules (`github-urls.ts`, `model-label.ts`, `feature-models.ts`, `types.ts`) and has no text utility yet, so a new flat module is the convention. `text-diff.ts` names what it does without claiming the whole `diff` package (`diff.ts` reads like a re-export) and without binding it to either feature (`prompt-diff.ts` would be wrong for `VersionsTab`, which diffs skill bodies). It exports exactly `DiffKind`, `DiffRow`, `toDiffRows`; `sortVersions` and `formatDate` stay in `VersionsTab/helpers.ts`. `VersionsTab.test.tsx` imports only `./VersionsTab` and is untouched by the move (verified).

**4. The `metrics_version` constant lives in `modules/evals/constants.ts`; the schema default is a literal pinned by a test.**
`EVAL_METRICS_VERSION = 2` goes in `server/src/modules/evals/constants.ts`, which imports nothing (`:1-15`), beside the rollup it names (`helpers.ts`, C7). `db/schema/eval.ts` uses the **literal** `.default(2)` and a hermetic test asserts `getTableConfig(evalRunBatches)`'s default equals `EVAL_METRICS_VERSION`. The alternative — importing the constant into the schema — would create a `db/schema → modules/**` edge that exists nowhere today and that the schema's own position as everyone's dependency argues against; the test gives AC-3's "one-line review target" without it.

## Steps

**Wave A — contracts (gates everything).**

1. **S1** — `server/src/vendor/shared/contracts/eval-ci.ts`: add `metrics_version: z.number().int()` to `EvalBatchRecord` (`:106-123`); make `EvalTrendPoint.recall/.precision/.citation_accuracy` nullable (`:57-64`); make `EvalDashboard.current.*` and `.delta.*` metrics nullable and `recent_runs: z.array(EvalBatchRecord)` (`:68-88`); **pending Q1**, add `trend_excluded: z.object({ other_version: z.number().int(), incomplete_metrics: z.number().int() })`; add `EvalRunComparison` (`old`/`new`: `EvalBatchRecord`; `old_config`/`new_config`: `AgentVersionConfig.nullable()`, imported from `./knowledge.js` as `:3` already does; `comparable: z.boolean()`; `incomparable_reason: z.string().nullable()`; `delta` with four nullable numbers) and `EvalPromoteResult` (`agent: Agent`, `version: z.number().int()`, `skills_not_restored: z.array(z.string())`). No index edit (R8). · ring 2 · skill: `zod`, `typescript-expert` · test: extend `server/test/contracts-eval.test.ts` — the all-null `EvalTrendPoint`/`EvalDashboard` fixture that fails today parses; `recent_runs` accepts two `EvalBatchRecord`s and rejects an `EvalRunRecord`; `EvalTrendPoint` still rejects `recall: "0.8"`; a key-set snapshot of each touched schema proves nothing was renamed; `EvalRunComparison` accepts `old_config: null` + `delta.recall: null` and rejects `comparable: "false"`; `EvalPromoteResult` accepts `skills_not_restored: []` and rejects a missing `agent` · satisfies: R4–R9, R27
2. **S2** — Mirror S1's *change* (not the file — the copies have drifted) into `client/src/vendor/shared/contracts/eval-ci.ts`. · ring 2 · skill: `zod`, `typescript-expert` · test: extend `client/src/test/eval-contract-parity.test.ts` — identical `safeParse` verdicts across both copies for the five schemas over two valid and three invalid fixtures, plus the untouched-contract control already there · satisfies: R10

**Wave B — schema + the two migrations (server only, sequential).**

3. **S3** — Add `export const EVAL_METRICS_VERSION = 2;` to `server/src/modules/evals/constants.ts` with the formula it names written out, and `metricsVersion: integer('metrics_version').notNull().default(1)` to `evalRunBatches` (`db/schema/eval.ts:85-116`) — **default 1 for this generate only** (see S5). · ring 1 (constant) / ring 4 (schema) · skill: `postgresql-table-design`, `drizzle-orm-patterns`, `onion-architecture` · test: S15's · satisfies: R1, R2, R3
4. **S4** — `cd server && pnpm db:generate` then `pnpm db:migrate`. Expect exactly one new `0023_*.sql` adding `"metrics_version" integer DEFAULT 1 NOT NULL`, plus `meta/0023_snapshot.json` and a `_journal.json` append. Read the SQL before migrating; never hand-edit it (C1, C2). · ring 4 · skill: none (migrations are `skip` in `skill-map.json:11`) · test: S15's `.it.test` · satisfies: R2
5. **S5** — Change the schema default to `.default(2)` (the literal, per Decision 4) and run `pnpm db:generate` + `pnpm db:migrate` again. Expect `0024_*.sql` to be an `ALTER TABLE … ALTER COLUMN "metrics_version" SET DEFAULT 2` and **nothing else** — existing rows keep `1`, which is R2. If the generate emits a drop/add pair or prompts, stop and report rather than edit. · ring 4 · skill: none · test: S15's · satisfies: R1, R2
6. **S6** — Stamp new batches: `InsertQueuedBatch` gains `metricsVersion: number`, `insertQueued` writes it (`repository/eval-batch.repo.ts:70-80`), and `EvalService.queueBatch` passes `EVAL_METRICS_VERSION` (`service.ts:137-144`). `toEvalBatchRecordDto` (`helpers.ts:215`) maps it into the DTO. · ring 3/4 · skill: `drizzle-orm-patterns`, `onion-architecture` · test: S15's unit negative control (the constant stubbed to `99` round-trips `99`, so the test reads the constant and not today's literal) · satisfies: R3, R4

**Wave C — the server dashboard + compare (needs A, B).**

7. **S7** — `server/src/modules/evals/helpers.ts`, **pure** (C7): `buildDashboard(batches: EvalRunBatchRow[], casesTotal: number): EvalDashboard` — `current` from the newest `done` (R12, `traces_*` from `cases_passed`/`cases_total`), `delta` against the newest earlier `done` of the same `metrics_version` with `null` on either operand null (R13, R17), `trend` ascending by `ran_at` capped at 20 (R14, `pass_rate` guarded per C22), `recent_runs` = 10 newest of any status (R15), `trend_excluded` counts (R47, Q1), `alert` via a `pickAlert(delta)` reading `EVAL_ALERT_THRESHOLD = -0.02` from `constants.ts`, `≤` comparison, tie order recall → precision → citation (R16); and `buildComparison(a, b, cfgA, cfgB)` — orders by `ran_at` (R20), `comparable` false + `incomparable_reason: 'metrics_version_mismatch'` on a version mismatch (R24), three metric deltas `null` while incomparable with `cost_usd` still computed (R25). · ring 1 · skill: `onion-architecture`, `typescript-expert` · test: `server/test/eval-dashboard.test.ts` — the spec's tables at `:534-535` verbatim, plus the two negative controls it names; `reduce` over `number | null` must pin its accumulator type (`server/INSIGHTS.md:521-527`) · satisfies: R12–R18, R20, R24, R25, R47
8. **S8** — `server/src/modules/evals/repository/eval-batch.repo.ts`: `getPairScoped(workspaceId, agentId, ids: [string, string])` (one `inArray` query, scoped on workspace **and** `agentId`, so a foreign batch simply does not come back → R21) and `hasLiveBatchForAgent(agentId)` keyed on `agent_id` + `LIVE_STATUSES` (C9, R34). Reuse the existing `listForAgent` for the dashboard's single batch-list read. · ring 4 · skill: `drizzle-orm-patterns`, `onion-architecture` · test: S15's integration files · satisfies: R21, R34
9. **S9** — `server/src/modules/evals/service.ts`: `dashboard(workspaceId, agentId)` — `requireAgent` (`:195-199`, R19) then **two** queries, `batchRepo.listForAgent` + `caseRepo.countForAgent` (`eval-case.repo.ts:130`), into `buildDashboard`; `compare(workspaceId, agentId, idA, idB)` — `requireAgent`, `422` on equal ids (R22), `getPairScoped` with `404` unless both come back (R21), `422` naming any non-`done` status (R23), `container.agentsRepo.getVersion(agentId, batch.agentVersion)` per side parsed through `AgentVersionConfig` with `null` when absent (R26), then `buildComparison`. · ring 3 · skill: `onion-architecture`, `security`, `typescript-expert` · test: S15's · satisfies: R11, R12, R15, R18, R19, R21–R23, R26
10. **S10** — `server/src/modules/evals/routes.ts`: `GET /agents/:id/eval-dashboard` (`params: IdParams`) and `GET /agents/:id/eval-runs/compare` (`params: IdParams`, `querystring: z.object({ a: z.string().uuid(), b: z.string().uuid() })` — Decision in R20). Transport only; extend the header route map. Registered **before** nothing it shadows: `/agents/:id/eval-runs` is a different depth, so order is immaterial. · ring 4 · skill: `fastify-best-practices`, `onion-architecture`, `security`, `zod` · test: extend `server/test/evals-routes.test.ts` (hermetic) for the `422` on a missing/duplicate query param, plus S15's integration files · satisfies: R11, R20, R22

**Wave D — promote (server; independent of Wave C after S8/S11).**

11. **S11** — `platform/container.ts`: `get evalBatchRepo(): EvalBatchRepository` beside `skillsRepo` (`:117-120`), with the Decision-1 reasoning in a comment. · ring 4 (composition root) · skill: `onion-architecture`, `typescript-expert` · test: S15's; also widen the `as Container` stub in `server/test/agents-versions.it.test.ts` (C8) · satisfies: R34
12. **S12** — `server/src/modules/agents/repository.ts`: `promoteVersion(workspaceId, agentId, version): Promise<{ row: AgentRow; skillsNotRestored: string[] } | undefined>` in **one transaction** — `SELECT … FOR UPDATE` the agent (mirroring `replaceSkillLinks`, `:274-280`); read the `agent_versions` row (`undefined` → the route's `404`, R35); parse `config_json` through `AgentVersionConfig`; resolve which snapshot skill ids still exist in this workspace, collecting the rest as `skillsNotRestored` (R32); rebuild links as *existing links in `order`, each `enabled` iff in the snapshot*, then the snapshot's missing-but-live ids appended (R30, R31); `UPDATE agents` with the seven config fields and `version = existing.version + 1`, touching neither `name`, `description` nor `enabled` (R28, R29); then insert the `agent_versions` snapshot **last**, so `skillIdsForAgent` sees the restored links (R28 — the ordering trap). Do **not** reuse `update()` + `replaceSkillLinks()`: `update()` snapshots before the links move, and `replaceSkillLinks` rejects the whole call on an unknown id instead of skipping it (`:290`), which contradicts R32. · ring 4 · skill: `drizzle-orm-patterns`, `postgresql-table-design`, `onion-architecture` · test: S15's `agent-promote.it.test.ts` · satisfies: R28–R32
13. **S13** — `server/src/modules/agents/service.ts`: `promote(workspaceId, agentId, version): Promise<EvalPromoteResult>` — `getById` → `NotFoundError` (R35's sibling); `version === agent.version` → `ConflictError` (R33); `container.evalBatchRepo.hasLiveBatchForAgent(agentId)` → `ConflictError` (R34); then S12, mapping `undefined` → `NotFoundError` (R35) and returning `{ agent: toAgentDto(row, count), version: row.version, skills_not_restored }` (R36). Both guards run **before** the transaction, so a refused promote writes nothing. · ring 3 · skill: `onion-architecture`, `security`, `typescript-expert` · test: S15's · satisfies: R33–R36
14. **S14** — `server/src/modules/agents/routes.ts`: `POST /agents/:id/versions/:version/promote` with the existing `VersionParams` (`:14-18`) and the header route map extended. · ring 4 · skill: `fastify-best-practices`, `onion-architecture`, `zod` · test: S15's · satisfies: R36
15. **S15** — The server test set:
    - `server/test/eval-metrics-version.it.test.ts` — R1/R2: the migrated column is NOT NULL; an insert omitting it reads `2`; a row inserted under the `0023` default reads `1`.
    - `server/test/eval-metrics-version.test.ts` (hermetic) — the schema default equals `EVAL_METRICS_VERSION` via `getTableConfig`; `0023_*.sql`'s text contains `DEFAULT 1` and `0024_*.sql`'s contains `SET DEFAULT 2`; the `insertQueued` stamp with the constant stubbed to `99`.
    - `server/test/eval-dashboard.test.ts` — S7's tables (R12–R18, R47).
    - `server/test/eval-dashboard.it.test.ts` — the spec's `:533` and `:536` seeds (R11, R12, R15, R18, R19).
    - `server/test/eval-compare.it.test.ts` — the spec's `:537-539` seeds (R20–R27), including the deep key scan for `actual_output`.
    - `server/test/agent-promote.it.test.ts` — the spec's `:540-542` seeds (R28–R36), including the `running`-batch `409` and its positive control once the batch is `done`.
    · skill: `typescript-expert` (test lane) · satisfies: the test half of R1–R36

**Wave E — client (parallel with C/D after Wave A).**

16. **S16** — New `client/src/lib/text-diff.ts` holding `DiffKind`, `DiffRow`, `toDiffRows` moved verbatim from `app/skills/_components/SkillDetail/_components/VersionsTab/helpers.ts:1-19`; that file keeps `sortVersions`/`formatDate` and **no longer exports** `toDiffRows`; `VersionsTab.tsx:12` imports it from `@/lib/text-diff`. · client feature/lib · skill: `react-code-organization`, `typescript-expert`, `security` · test: new `client/src/lib/text-diff.test.ts` with the spec's six-case table (`:551`); plus the two structural assertions there — `VersionsTab/helpers.ts` no longer exports `toDiffRows`, and no file under `client/src/app/agents/` imports from `client/src/app/skills/`. `VersionsTab.test.tsx` must pass **unchanged** · satisfies: R57, R58
17. **S17** — Hooks: in `client/src/lib/hooks/evals.ts` add `useAgentEvalDashboard(agentId)` (key `["agent-eval-dashboard", agentId]`) and `useEvalCompare(agentId, pair)` (key `["eval-compare", agentId, a, b]`, `enabled: !!pair`, so it fires only on demand — spec `:433-438`); reuse the existing `useEvalBatch` for the case-detail fetch (R73). In `client/src/lib/hooks/agents.ts` add `usePromoteAgentVersion(agentId)` invalidating `["agent", id]`, `["agents"]`, `["agent-skills", id]` and `["agent-eval-dashboard", id]` (R69). All contract imports `import type` (C16). · client data layer · skill: `react-best-practices`, `next-best-practices`, `typescript-expert` · test: driven through S24's component tests (the hooks are mocked there) · satisfies: R52, R68, R69, R73
18. **S18** — `EvalsTab/helpers.ts` (pure) + `constants.ts`: `toTrendSeries(trend): { series: ChartSeries[]; dropped: number }` — drop any point with a `null` metric from **all three** series, every element `Number.isFinite`, equal lengths, index-aligned (R42–R44); `formatDeltaTile(value, placeholder)` returning a signed string (`+2.1pt` / `-2.1pt`) so direction is textual (R39, R40); `plottable(series)` for the `< 2` empty state (R46); `ALERT_MESSAGE_KEY` / `INCOMPARABLE_REASON_KEY` maps as `satisfies Record<Code, string>` plus the widened lookup alias (`client/INSIGHTS.md:194-200`). · client feature · skill: `react-code-organization`, `typescript-expert` · test: extend `EvalsTab/helpers.test.ts` with the spec's `:545` assertions (index-alignment checked via `recall[2]`, the no-null control, the `Number.isFinite` sweep) and a `formatDeltaTile` table · satisfies: R39, R40, R42–R44, R46
19. **S19** — New `EvalsTab/_components/RecentRunsTable/` (`RecentRunsTable.tsx`, `styles.ts`, `index.ts`) following the `SkillsTab/_components/SkillRow/` convention: one row per `recent_runs` entry with all seven columns (R48), a `Checkbox` only on `done` rows (R49), every unselected checkbox disabled at two selections (R51), and a trailing cell holding a plain `<button>` with an exact accessible name naming the run (R72, C13) — no `onClick` on the `<tr>`, no `role="button"`, status shown with `Badge` and never `Chip`. Horizontal scroll rather than compressed numeric columns. · client feature · skill: `react-best-practices`, `react-code-organization`, `next-best-practices` · test: S24's · satisfies: R48–R51, R72
20. **S20** — New `EvalsTab/_components/CompareModal/` (`CompareModal.tsx`, `helpers.ts`, `styles.ts`, `index.ts`): title with both versions old→new (R53); four tiles with old, new and signed delta, cost through `formatCostTile` (R54, R55); the incomparable warning with placeholder metric deltas and a live cost delta (R56); the diff block from `@/lib/text-diff` with a text marker per line and plain-text rendering — no `dangerouslySetInnerHTML`, no markdown renderer (R57, R59, R60); the `null`-config notice with the tiles still rendered (R61); "no prompt change" on identical prompts (R62); the promote control labelled with the new version and disabled-with-reason when it is already current (R63, R64); and the promote confirmation as a **second step inside this same `Modal`** naming version, `new_config.model` and `new_config.skills.length` (R65, Decision 2), issuing nothing until accepted (R66, R67), exactly one `POST` on accept (R68), an i18n confirmation on success (R69) and `error.message` inline with the modal still mounted on failure (R70). · client feature · skill: `react-best-practices`, `react-code-organization`, `next-best-practices`, `security` · test: S24's · satisfies: R53–R57, R59–R70
21. **S21** — New `EvalsTab/_components/CaseDetailDialog/`: one row per `runs` entry with case name, pass state **as text** and the three metrics (R74); a `role="status"` loading indicator carrying its own `aria-label` (R75, C15); `error.message` + retry, staying open (R76); empty state (R77); the "N cases deleted since this sweep" note when `runs.length < batch.cases_total` (R78); the placeholder for a `null` `case_name` (R79); and **no** read of `actual_output` anywhere in the folder (R80). · client feature · skill: `react-best-practices`, `react-code-organization`, `security` · test: S24's · satisfies: R74–R80
22. **S22** — `EvalsTab/EvalsTab.tsx`: add the dashboard query; three delta tiles above 0019's five (R37–R39); the alert banner (R41); the `LineChart` with `yMin={0} yMax={1}` and the `< 2`-point empty state (R42, R45, R46); the exclusion note carrying both counts separately (R47); `RecentRunsTable` with selection state capped at two and the Compare control disabled otherwise (R50, R52); the **single-slot** dialog state of Decision 2; and a `window` keydown `Escape` handler plus an opener-ref focus restore for each dialog (R71, C12, precedent `AddRepoView.tsx:25-31`). Keep 0019's `isLoading` gating idiom (`:82-91`, `client/INSIGHTS.md:187-192`). · client feature · skill: `react-best-practices`, `react-code-organization`, `next-best-practices` · test: S24's · satisfies: R37–R39, R41, R45–R47, R50, R52, R71, R73
23. **S23** — `client/messages/en/evals.json`: add `deltas.*`, `alert.{recallDrop,precisionDrop,citationDrop}`, `trend.{empty,excluded}`, `recentRuns.*` (including the detail button's name), `compare.*` (title, tiles, warning, reasons, diff notices, promote label + disabled reason), `promoteConfirm.*`, `caseDetail.*` (including `loading` for the `aria-label`), all camelCase, in the **existing** file — no new namespace (R81, C17). · client i18n · skill: none routed (`client/messages/**` is `skip`, `skill-map.json:15`) · test: S24's empty-catalogue test · satisfies: R41, R56, R81
24. **S24** — The client test set:
    - extend `EvalsTab/EvalsTab.test.tsx` — the spec's `:543-548`, `:557` and `:560-561` cases (tiles, placeholders, direction in text, banner present/absent, chart props on a stubbed primitive incl. the live `0.00` control, empty state, both exclusion counts, the four-row selection table, Compare enablement, per-row detail button by **exact** name with the third row asserted, `Escape` + focus restore, the empty-catalogue sweep).
    - new `CompareModal.test.tsx` — `:549-556`, including the `<script>`/`**bold**` verbatim-render case and the promote-confirmation reads taken `within(getByRole("dialog"))` **by text**.
    - new `CaseDetailDialog.test.tsx` — `:558-559`, including the `INJECTED-FINDING-TEXT` absence check.
    - new `client/src/test/evals-static.test.ts` — source-text assertions no runtime test can make: every new file under `client/src/app/agents/` imports `@devdigest/shared` as `import type` (C16); no file in the compare-modal folder references `dangerouslySetInnerHTML` or a markdown renderer; no component under the dialog folder reads `actual_output`; `client/messages/en/` gained no file.
    · skill: `react-testing-library` · satisfies: the test half of R37–R81

## Skills for the implementer
| Path (glob) | Skills | What they will require here |
|---|---|---|
| `{server,client}/src/vendor/shared/contracts/eval-ci.ts` | `zod`, `typescript-expert` | Additive-only edits; `.nullable()` not `.nullish()` where the contract says nullable; a schema and its `z.infer` share one name |
| `server/src/db/schema/eval.ts` | `postgresql-table-design`, `drizzle-orm-patterns`, `onion-architecture` | snake_case column ↔ camelCase property; NOT NULL + default; no `CHECK` illusions (C3) |
| `server/src/modules/{evals,agents}/repository*/**` | `drizzle-orm-patterns`, `onion-architecture` | The only ring holding drizzle; one transaction for the promote; no N+1 |
| `server/src/modules/{evals,agents}/service.ts` | `onion-architecture`, `security`, `typescript-expert` | Ring 3: no drizzle, no SDK, container ports only; workspace scoping on every read |
| `server/src/modules/{evals,agents}/routes.ts` | `fastify-best-practices`, `onion-architecture`, `security`, `zod` | Transport only; shared Zod contracts as route schemas; no hand-rolled `.parse` |
| `server/src/platform/container.ts` | `fastify-best-practices`, `onion-architecture` | Composition root only; lazy getter idiom |
| `server/src/modules/evals/{helpers,constants}.ts` | `onion-architecture`, `typescript-expert` | Provably pure; explicit `reduce<number>` accumulators |
| `client/src/app/agents/**/*.tsx`, `client/src/lib/*.ts` | `react-best-practices`, `react-code-organization`, `next-best-practices` | `_components/<PascalCase>/` beside its test/styles/helpers/constants; hooks in `lib/hooks/<domain>.ts`; no hardcoded copy |
| `client/**/*.test.{ts,tsx}` | `react-testing-library` | Queries by role/accessible name, exact names near wrapper controls, no `getByRole("heading")` on a vendored `Modal` |
| everything else in the diff | `security`, `typescript-expert` | Untrusted text never becomes markup; no `actual_output` on screen |
| `server/src/db/migrations/**`, `client/messages/**`, `client/src/vendor/**` | **none — `skip`** | `skill-map.json:11-16`; vendored UI must not appear in the diff at all (C10) |

## Verification
| Package | Command | What counts as pass |
|---|---|---|
| `server/` | `pnpm typecheck` | clean |
| `server/` | `pnpm lint` (eslint + `pnpm arch`) | clean — `pnpm arch` is the gate on Decision 1; prove it fires by temporarily importing `modules/evals/repository/eval-batch.repo.js` into `agents/service.ts` and seeing one error, then reverting (`server/INSIGHTS.md:547-553`) |
| `server/` | `pnpm exec vitest run --exclude '**/*.it.test.ts'` | all green, including the widened `as Container` stub (C8) |
| `client/` | `pnpm typecheck` · `pnpm lint` · `pnpm test` | all green; `VersionsTab.test.tsx` green **unchanged** |
| `reviewer-core/` | `npm run typecheck && npm test` | untouched by the diff, but a `vendor/shared/` change requires it as the cheap confirmation that the nullability change did not reach the engine |
| `server/` (**the user's**) | `cd server && pnpm exec vitest run .it.test` | The green-run rule: a non-zero `skipped` count, a non-zero exit, or a FAIL in a file this change does not touch is **not** a pass (`server/INSIGHTS.md`). Until the user runs it, S4/S5's migration behaviour and R11–R36 are implemented-but-unverified |
| root (**the user's**) | `./scripts/e2e.sh` | The UI changed, so the seeded flows must still pass; 0020 adds no flow |
| root (**the user's**) | `/pr-self-review` before any push | manual-only (`disable-model-invocation: true`); any `CRITICAL` blocks the PR |
| root (**the user's**) | `git diff --name-status client/src/vendor/` | must print nothing (C10, spec `:458-462`) — this is the review check the spec deliberately left un-criterioned |
| dev app (**the user's**) | `./scripts/dev.sh` + the two manual walks at `:562-563` | The only check of what the feature exists for, and the only check of the cross-formula refusal against the six live pre-fix batches |

## Recommendations
| ID | Proposal | Why (`path:line`) | Cost if adopted (steps and files) | If declined |
|---|---|---|---|---|
| P1 | Amend the spec's `## Problem & why` sentence that calls the current formula "pooled, expectation-denominated metrics" | `:41-49` over-generalises: `citation_accuracy` is a per-case **mean** today, not pooled, and deliberately so (`server/INSIGHTS.md:578-583`, `helpers.ts:111-133`) | 0 steps — prose only, in `spec-creator`'s hands | The plan is unaffected; a later reader re-derives the correction from INSIGHTS, as I had to |
| P2 | Compare the alert threshold with a small epsilon (`delta <= -0.02 + 1e-9`) or round deltas to 4 dp before the test | `0.02 - 0.04 === -0.019999999999999997` in IEEE 754, so AC-16's "at most `-0.02`" silently misses some genuine 2-point drops; the spec's own boundary test (`:535`) passes a delta directly and cannot see it | 1 line in S7 + 1 test row | The boundary is float-dependent: some pairs alert, some do not, and nothing in the suite reveals it |
| P3 | Drop 0019's `useAgentEvalBatches` call from the tab and drive the five existing tiles, the live badge and the new table from `recent_runs` | `## Non-functional` budgets the initial paint at **two** requests (`:433-438`); the tab issues three today (cases, batches, batch detail) and would issue four. `recent_runs` (10, any status, newest-first) is a superset of what `latestBatch`/`latestCompletedBatch` read | ~1 extra step; `EvalsTab.tsx`, `helpers.ts` and ~4 mocks in `EvalsTab.test.tsx` | The paint stays at four requests and the stated budget is simply wrong — see Q2 |
| P4 | Add an `EvalDashboard` criterion for `traces_passed`/`traces_total` in the no-batch case | AC-18 (`:186`) says "every `current` and `delta` metric `null`", but those two fields are non-nullable ints (`eval-ci.ts:76-77`), so `0`/`0` is an unstated decision | 0 steps (already planned as `0`/`0`); one new AC for `spec-creator` | The value is correct but unasserted, so a later change to `null` would pass review |
| P5 | Add `skills_not_restored` coverage for a skill that exists but is **globally disabled** | `skillIdsForAgent` filters `skills.enabled = true` (`repository.ts:225-239`), so such a skill is linked-enabled by promote yet omitted from the new snapshot — the promoted version and its restoration are then not byte-identical, which `## Decisions` (`:115`) promises they are | ~0.5 step in S12 + 1 test row | A rare, silent asymmetry between the promoted config and the recorded one |
| P6 | Add a criterion: a snapshot that exists but fails `AgentVersionConfig.parse` is treated as that side being `null` | AC-26 (`:208`) covers only a *missing* snapshot; a drifted one throws, and the route returns 500 where the modal's own `null`-config path (AC-58) already handles it gracefully | ~2 lines in S9 + 1 test row | A drifted historical snapshot 500s the whole compare instead of degrading to the notice the UI already renders |

## Clarification needed

**Blocked:** R47

1. **AC-45's exclusion counts are not computable from the payload (R47).** The note must name, separately, how many `done` batches the trend excluded for an older `metrics_version` and how many for an incomplete metric triple. `trend` holds only the *included* points (AC-14) and `recent_runs` is 10 rows of any status (AC-15), so a client-side count is wrong for any agent with more than ten batches. — *default:* add `trend_excluded: { other_version: number; incomplete_metrics: number }` to `EvalDashboard` in both contract copies (S1/S2) and compute both in the dashboard service, which already has every batch row in hand; AC-5–AC-7 then need one more field and AC-45 becomes satisfiable, which I file as an amendment for `spec-creator` · *cost of the other choice:* the counts are derived from `recent_runs` and are provably wrong past ten batches — a note that says "2 excluded" when five were. Unblocks R47.
2. **The paint-request budget (`## Non-functional`, `:433-438`) says two; the tab will issue four.** 0019's tab already issues three (cases, batches, latest batch detail) and 0020 adds the dashboard. — *default:* ship four and treat the budget line as stale (the compare and case-detail requests remain strictly on demand, which is the part that protects spend); P3 is offered but not planned · *cost of the other choice:* adopting P3 removes one request but rewires three of 0019's rendered values onto a new source and touches four mocks in a 425-line test file, inside a plan that otherwise adds to that tab rather than rewiring it.
3. **Is `metrics_version` meant to stamp all three metrics or only the two that changed?** C14: `citation_accuracy` is still a per-case mean, so a "version 1 vs 2" refusal withholds a `citation_accuracy` delta that is in fact comparable across the boundary. — *default:* keep one version for the whole metric set, as AC-1–AC-3 and AC-24 are written: it refuses more than strictly necessary and permits nothing invalid, which matches the spec's own "lossy in the safe direction" (`:383`) · *cost of the other choice:* a per-metric version vector — three columns or a JSON stamp, a wider contract, and three independent comparability verdicts in the modal, for one metric's deltas across one historical boundary.

## Out of scope
| Not in this plan | Why | Who owns it |
|---|---|---|
| The all-agents Eval Dashboard index and `GET /eval-dashboard` | spec `:72-73`, settled by the user | a later spec |
| Any `client/src/vendor/ui/nav.ts` edit, a `/evals` route, a `g e` shortcut | spec `:74-79`; no new top-level page ships, so the one sanctioned exception does not apply | nobody — deliberately permanent |
| Fixing `LineChart`'s `?? 0` coercion and `yMin` default at the primitive | C10 — vendored, "Do not touch", an undowngradable repo-rule CRITICAL. Every accommodation is in the caller | a vendored-UI refresh, if ever |
| **Focus *trapping* in either dialog** | `## Non-functional` (`:450`) claims the modal traps focus; the vendored `Modal` does not and cannot be made to without editing `client/src/vendor/ui/kit/Modal.tsx`. Escape + focus restore (AC-64) **are** implemented in the caller (S22); trapping is not, and no criterion requires it | `spec-creator` + the user, if trapping is wanted — it needs a non-vendored modal |
| The mockups' page chrome: breadcrumb, title block, "All agents" link, agent switcher, header "Run eval" | spec `:80-89` — a recorded design deviation, not an omission | nobody |
| The date-range picker; backfilling pre-2026-10-08 batches; per-case drill-down *inside* the compare modal; confidence intervals; skill-owned evals; the manual Case Editor | spec `:91-104` | later specs |
| A second diff implementation, or a markdown renderer in the diff path | AC-55, AC-57 | nobody |
| An e2e flow for the compare modal | No flow touches the Evals tab today; the UI change is covered by the existing suite plus the manual walks | a later task, if the flow set grows |
| Architecture review, correctness review, coverage backfill | Separate agents on the same diff; `/pr-self-review` is **the user's** to run | `architecture-reviewer`, `/code-review`, `test-writer`, the user |

## Not found
| Looked for | How (verbatim command) | Conclusion | What would settle it |
|---|---|---|---|
| Whether `drizzle-kit generate` emits a bare `ALTER COLUMN … SET DEFAULT` for S5's default flip | reasoned from `server/INSIGHTS.md:231-238` (the add/drop prompt trap) only | **inconclusive** — S5 instructs the implementer to read the emitted SQL before migrating and to stop rather than hand-edit if it is anything else | running `pnpm db:generate` on the S5 schema and reading `0024_*.sql` |
| Whether the dev DB's six pre-fix batches survive the two migrations with `metrics_version = 1` | `git log --oneline` (found `1a5b2c8`) and the spec's own measured claim (`:44-49`) | **unverified on a live DB** — the plan depends on it for the second manual walk | `docker compose exec postgres psql -U devdigest -d devdigest -c 'select id, metrics_version from eval_run_batches order by ran_at'` after S5 |
| Whether `AgentVersionConfig` parses every snapshot now in the dev DB | `grep -n -A14 'export const AgentVersionConfig' server/src/vendor/shared/contracts/knowledge.ts` — `strategy`, `ci_fail_on`, `repo_intel` are all **required** | low risk (`snapshotVersion`, `repository.ts:168-187`, always writes all eight) but **unverified for rows written before 0006 settled the shape** | `select version, config_json from agent_versions` on the dev DB, or P6 |
| Which of the eight `as Container` test files actually construct `AgentsService` | `grep -rln "as unknown as Container\|as Container" server/test` (eight files; only `agents-versions.it.test.ts` is named by title) | **inconclusive** — S15 says "widen the stub in `agents-versions.it.test.ts`"; another file may also need it | `Grep "new AgentsService" server/test` |
| An exact `IconName` for the new recent-runs detail button | not searched | **not chosen** — S19 leaves the icon to the implementer, matching `AgentEditor/constants.ts`'s existing vocabulary | `Grep "export type IconName" client/src/vendor/ui` |
| Whether any `e2e/flows/*.json` step touches `?tab=evals` | not searched (0019's plan recorded none, and 0020 adds no route) | **inconclusive** — the user's `./scripts/e2e.sh` run is the check either way | `Grep "tab=evals" e2e/flows` |

## Execution mode

**Recommendation: multi-agent.** 24 steps across two packages plus two vendored contract copies; after Wave A the server work (S3–S15) and the client work (S16–S24) share no file and no suite, and only Waves B→C/D are sequentially dependent inside the server. One context would otherwise have to hold the onion rings, drizzle's migration flow, Fastify route conventions, the `_components/` layout, next-intl and `react-testing-library` — nine or more skills — and the client test surface (four files, ~40 assertions) is exactly where a reader who did not write the component earns their keep.

**Multi-agent decomposition** (base ref for every reviewer: **`origin/main`**, never `HEAD` — a `HEAD` verdict dies on the next commit, root `INSIGHTS.md:132`)

| Wave | Agent | Steps | Runs in parallel with | Handoff artifact |
|---|---|---|---|---|
| 1 | `implementer` (contracts) | S1, S2 | — | Both `eval-ci.ts` copies; `contracts-eval.test.ts` + `eval-contract-parity.test.ts` green |
| 2a | `implementer` (server) | S3–S15 | 2b | `server` typecheck + lint + unit green; `0023_*`/`0024_*` generated and migrated; six `.it.test.ts` files written but **not run** |
| 2b | `implementer` (client) | S16–S24 | 2a | `client` typecheck + lint + `pnpm test` green; `VersionsTab.test.tsx` green unchanged |
| 3 | **`plan-verifier`** (gate) | — | — | Step-by-step Present/Missing/Contradicted over the full diff against this plan. A `Missing` or `Contradicted` goes back to the owning implementer and **wave 4 does not run** |
| 4 | `architecture-reviewer` ∥ `/code-review` (**the user**) ∥ `test-writer` | — | each other, same diff | Layering verdict (Decision 1 is its headline question) · correctness verdict · coverage backfill |
| 5 | `plan-verifier` (delta) | — | — | Only if `test-writer` added files |

Waves 2a and 2b are safe to co-run: their file sets are disjoint (`server/src/**`, `server/test/**` vs `client/**`, with `client/src/vendor/shared/contracts/eval-ci.ts` already finished in wave 1) and they run different package suites, so neither C20's shared-working-directory hazard nor a suite collision applies. **Wave 1 must finish first** — both implementers typecheck against the new contracts. Inside 2a, S3→S4→S5→S6 is strictly ordered (two generates against one evolving schema) and S7–S14 follow; a second agent in `server/` would mean two `pnpm db:migrate` runs against one dev DB, which C20 forbids.

Test ownership, so no two agents write one file: each `implementer` writes the tests its own steps name. `test-writer` backfills **only** `server/test/eval-compare.it.test.ts`'s negative paths and `CaseDetailDialog.test.tsx`'s error/retry branch — the two places a fresh reader is worth the handoff — and may run **only the file it wrote**, never the `.it.test` lane.

**Single-agent decomposition**
S1 → S2 → S3 → S4 → S5 → S6 → S7 → S8 → S9 → S10 → S11 → S12 → S13 → S14 → S15 → S16 → S17 → S18 → S19 → S20 → S21 → S22 → S23 → S24, in one context, loading `zod` + `typescript-expert` before S1; `postgresql-table-design` + `drizzle-orm-patterns` before S3; `onion-architecture` before S7 (and re-read §6 before S11); `fastify-best-practices` + `security` before S10; `react-code-organization` + `react-best-practices` + `next-best-practices` before S16; `react-testing-library` before S24.

**Cost of the mode I recommend:** one hard handoff at wave 1 — the contracts must be right before two agents build on them, and Q1's answer changes them, so a late answer invalidates both — plus a fully serialised server wave, so multi-agent buys parallelism on roughly 40% of the work and fresh-eyes review on all of it.

---

## Session decisions on the plan's clarifications (2026-10-08)

The user chose **multi-agent** before the plan returned ("run the subagent chain"), which matches the recommendation above.

| Q | Resolution | Who |
|---|---|---|
| Q1 — AC-45's exclusion counts | **Default taken**: `trend_excluded: { other_version, incomplete_metrics }` added to `EvalDashboard` in both contract copies and computed server-side. Filed as a spec amendment before wave 1, because it changes S1/S2 | session |
| Q2 — paint-request budget | **Default taken**: ship four requests; the `## Non-functional` budget line is stale and amended to match. P3 declined — rewiring three of 0019's rendered values onto a new source is not worth one request inside a plan that otherwise only adds | session |
| Q3 — `metrics_version` granularity | **Default taken**: one version for the whole metric set. It refuses more than strictly necessary and permits nothing invalid | session |
| P2 — float epsilon on the alert threshold | **Adopted**: a real defect (`0.02 - 0.04 === -0.019999999999999997`), one line plus one test row | session |
| P1, P4, P5, P6 | Filed as spec amendments with Q1 and Q2 | session |

---

## Addendum — AC-82 … AC-88 (session, 2026-10-08)

The seven amendments the planner's audit forced are now in the spec, which moved 81 → 88 criteria (`check-specs.sh` green). The plan's step list is unchanged; these criteria attach to existing steps.

| New AC | Requirement | Step | Note |
|---|---|---|---|
| AC-82 | `EvalDashboard` carries `trend_excluded: { other_version, incomplete_metrics }`, non-negative ints | S1, S2 | S1's "pending Q1" clause is now **confirmed** — add the field |
| AC-83 | The dashboard service computes both counts over **every** batch of the agent, not only those the response returns | S7, S9 | `buildDashboard` already receives the full `batches` array, so this is in scope of the existing signature |
| AC-45 (reworded) | The note renders the two server-supplied counts, deriving neither from `trend` nor `recent_runs` | S22 | The test fixture ships `trend` of 5 and `recent_runs` of 10 against counts of 3 and 2 — numbers matching neither array, so a client-side derivation fails rather than coincidentally passing |
| AC-84 | The alert threshold comparison tolerates IEEE 754 error (epsilon or 4-dp rounding) | S7 | P2, adopted. Test computes the delta **from two metric values**, not a literal; negative control `0.02` vs `0.039` stays `null` |
| AC-85 | No `done` batch → `traces_passed` and `traces_total` are `0`, not null | S7, S9 | Already how S7 was planned; now asserted with `toBe(0)` and an `EvalDashboard.parse` of the whole response |
| AC-86 | A snapshot that exists but fails `AgentVersionConfig.parse` → that side is `null`, status `200` | S9 | P6, adopted. Lands on AC-58's existing notice |
| AC-87 | A snapshot skill that exists but is globally disabled is link-enabled **and** reported in `skills_not_restored` | S12, S13 | P5, adopted. The rejected repair — enabling the skill workspace-wide — is recorded in the spec's edge cases |
| AC-88 | Invariant: new snapshot `skills` ∪ `skills_not_restored` = the promoted snapshot's `skills` | S12, S13 | Asserted in the plain case too, so a response reporting everything as unrestored fails |

### Two residuals `spec-creator` raised, resolved here

**AC-88's ordering assumption is already pinned.** It assumes the `agent_versions` snapshot is written *after* link reconciliation, since `snapshotVersion` reads `skillIdsForAgent` at write time (`repository.ts:168-187`). S12 already mandates exactly that ("then insert the `agent_versions` snapshot **last** … R28 — the ordering trap"). No change; the implementer must not reorder it, and AC-88 failing is the symptom if they do.

**AC-83 duplicates AC-43's predicate across the package boundary, and that is accepted with a guard.** "Any of the three metrics is `null`" is now computed twice: server-side for `trend_excluded.incomplete_metrics` (S7) and client-side to drop the point from all three series (S18). They cannot share code — separate packages, and the shared contracts carry schemas, not logic. If they drift, the note's count stops matching the chart.

Guard, owned by S24: one `EvalsTab` test fixture in which the server-supplied `trend_excluded.incomplete_metrics` and the number of points `toTrendSeries` drops are **both** non-zero and equal, asserted against each other rather than against literals. That does not prevent drift, but it fails loudly the first time either side changes its predicate — which is the cheapest thing available short of moving the rule into the contract.
