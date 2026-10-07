# Development Plan — spec 0019 (Evals)

## Task
Plan slice 1 of the evals harness: the whole migration, the pure scorer in `reviewer-core`, the server `evals` module (cases from findings, batch run executor, SSE, cancel, boot reap), and the client Evals tab + "Turn into eval case" control — 75 acceptance criteria, no dashboard (that is 0020).

## Requirements source
| Governing spec | `status:` (`path:line`) | Criteria it defines | Rows in my review |
|---|---|---|---|
| `/home/komp/dev-digest/specs/0019-evals.md` | `status: approved` (`specs/0019-evals.md:3`) | 75 (AC-1 … AC-75) | 75 |

Counts match. Beyond the spec the caller asked me to settle three open design points (`RunLogger` vocabulary, reap placement, `loadSkills` lift); those are answered in `## Decisions I settled`, not added as requirement rows — they are *how*, not *what*.

## Requirements review

| ID | Requirement, restated | Source | Verdict | Satisfied by |
|---|---|---|---|---|
| R1 | A new `eval_run_batches` table carries id, workspace, owner, agent id + version, ran_at, status, error, three ratios, cases_total/passed, duration_ms, cost_usd | `:123-126 (AC-1)` | clear | S8, S10 |
| R2 | `eval_runs` gains `batch_id` FK cascading from `eval_run_batches` | `:127 (AC-2)` | clear | S8, S10 |
| R3 | `eval_cases` gains `expectation_kind` enum NOT NULL + three expected-target columns | `:130 (AC-3)` | clear | S8, S10 |
| R4 | Ratio columns are `doublePrecision`; both `cost_usd` are `numeric(12,6)` | `:132 (AC-4)` | clear | S8 |
| R5 | `eval_cases` gains nullable `source_finding_id` and `created_at default now()` | `:134 (AC-63)` | clear | S8, S10 |
| R6 | Unique index on `(owner_id, source_finding_id)` partial on NOT NULL | `:136 (AC-64)` | clear | S8, S10 |
| R7 | The diff adds exactly one migration + its meta snapshot and modifies no existing `.sql` | `:139 (AC-5)` | clear | S10 (test: `migrations-additive.test.ts`); see P4 — it is a review check, not product behaviour |
| R8 | The barrel exports `EvalExpectationKind`, `EvalBatchRecord`, `EvalCaseFromFindingInput`, nothing renamed/removed | `:145 (AC-6)` | ambiguous | Q3 · S1, S3 |
| R9 | `EvalBatchRecord` carries the 16 snake_case fields with a five-member `status` | `:148 (AC-7)` | clear | S1 |
| R10 | The client contract copy mirrors the same three schemas and nothing else | `:154 (AC-8)` | ambiguous | Q3 · S4 |
| R11 | `reviewer-core/src/index.ts` exports `scoreEvalCase` | `:160 (AC-9)` | clear | S7 |
| R12 | `scoreEvalCase` is pure — no LLM, DB or filesystem | `:161 (AC-10)` | clear | S6 (test is a static-import assertion, see P5) |
| R13 | A finding matches an expectation on same file + intersecting inclusive normalised ranges, reusing `rangeIntersects` | `:164 (AC-11)` | **contradicted by repo** — `rangeIntersects` (`reviewer-core/src/grounding.ts:41-51`) is **not exported** and its signature is `(lines: Set<number>, start, end)`, a set-vs-range test, not range-vs-range | Q1 · S5, S6 |
| R14 | `recall` = matched `must_find` expectations / `must_find` expectations | `:168 (AC-12)` | clear | S6 |
| R15 | `precision` = produced findings matching ≥1 expectation / produced findings | `:170 (AC-13)` | clear | S6 |
| R16 | `citation_accuracy` = kept / (kept + dropped) from the `ReviewOutcome` | `:173 (AC-14)` | clear | S6 |
| R17 | `must_find` passes iff every expectation is matched | `:175 (AC-15)` | clear | S6 |
| R18 | `must_not_flag` passes iff no finding matches the expected file+range | `:177 (AC-16)` | clear | S6 |
| R19 | A zero denominator yields `1`, never `NaN`/`null`/`undefined` | `:179 (AC-17)` | clear | S6 |
| R20 | Batch ratios are the unweighted mean over cases with non-null metrics | `:186 (AC-18)` | clear | S14 |
| R21 | `cases_total` = cases queued; `cases_passed` = child rows with `pass=true` | `:189 (AC-19)` | clear | S13, S14 |
| R22 | Batch `cost_usd` = decimal (non-float) sum; `duration_ms` = first case start → terminal | `:191 (AC-20)` | clear | S13, S14 |
| R23 | Any case with null `cost_usd` makes the batch's `cost_usd` null | `:194 (AC-65)` | clear | S14 |
| R24 | `POST /eval-cases` on a valid input → `201` + exactly one row | `:200 (AC-21)` | clear | S12, S16, S17 |
| R25 | Creation sets `owner_kind='agent'`, `owner_id` = the finding's review's agent, and the three expected-target fields from the finding | `:202 (AC-22)` | clear | S16 |
| R26 | `expectation_kind` derived `must_find` from `accepted_at`, else `must_not_flag` from `dismissed_at` | `:205 (AC-23)` | clear | S16 |
| R27 | The PR's unified diff is snapshotted into `input_diff` at creation | `:208 (AC-24)` | clear, but its only diff source is banned by R35 | Q2 · S16 |
| R28 | Creation sets `source_finding_id` to the finding's id | `:211 (AC-66)` | clear | S16 |
| R29 | A duplicate `(owner_id, source_finding_id)` → `409 conflict`, no second row | `:213 (AC-67)` | clear | S8, S12, S16 |
| R30 | A finding neither accepted nor dismissed → `422 validation_error`, no row | `:215 (AC-25)` | clear | S16 |
| R31 | An unloadable PR diff → `422` naming the reason, no row | `:217 (AC-26)` | clear, same dependency as R27 | Q2 · S16 |
| R32 | `GET /agents/:id/eval-cases` scopes by workspace+owner, orders `created_at DESC, id ASC` | `:222 (AC-27)` | clear | S12, S17 |
| R33 | `PATCH /eval-cases/:id` persists supplied fields only, `200` with the updated case | `:225 (AC-28)` | clear | S1, S12, S17 |
| R34 | `DELETE /eval-cases/:id` → `200` and its `eval_runs` rows are gone | `:228 (AC-29)` | clear | S8 (cascade), S12, S17 |
| R35 | Any evals route given an unknown or foreign-workspace id → `404 not_found` | `:230 (AC-30)` | clear | S12, S13, S16, S17 |
| R36 | `POST /agents/:id/eval-runs` accepted → `202` with `batch_id` | `:235 (AC-31)` | clear | S16, S17 |
| R37 | On `202` exactly one `queued` batch exists and zero child runs | `:237 (AC-32)` | clear | S13, S16 |
| R38 | Zero cases → `422 validation_error`, no batch | `:239 (AC-33)` | clear | S16 |
| R39 | A `queued`/`running` batch for that agent → `409 conflict`, no second batch | `:241 (AC-34)` | clear | S13, S16 |
| R40 | `GET /agents/:id/eval-runs` returns the agent's batches `ran_at DESC` | `:243 (AC-68)` | clear | S13, S17 |
| R41 | `POST /eval-runs/:batchId/cancel` on a live batch → `200` + aborts the registered controller | `:245 (AC-69)` | clear | S16, S17 |
| R42 | Cancelling a terminal batch → `409 conflict`, no row changed | `:248 (AC-70)` | clear | S16 |
| R43 | A signalled cancellation starts no further case, sets `cancelled`, keeps written rows | `:250 (AC-71)` | clear | S15 |
| R44 | The evals reap method fails every `queued`/`running` batch with an error naming the interruption | `:253 (AC-72)` | clear | S13, S16 |
| R45 | `buildApp` calls that reap inside its existing non-test block | `:256 (AC-75)` | clear | S19 (no automated test by construction — `## Out of scope`) |
| R46 | `GET /eval-runs/:batchId` returns the batch + one entry per child run with 8 named fields | `:259 (AC-35)` | clear | S1, S13, S17 |
| R47 | The executor publishes `RunEvent`s on `runBus` keyed by batch id through `RunLogger` | `:265 (AC-36)` | clear | S15 (vocabulary pinned in `## Decisions I settled`) |
| R48 | The executor calls `reviewPullRequest` directly; `modules/evals/` imports neither `reviews/run-executor.ts` nor `reviews/diff-loader.ts` | `:268 (AC-37)` | **contradicted by repo** — R27/R31 and the Inputs table (`:433`) require `loadDiff`, which lives in `reviews/diff-loader.ts`, and `.dependency-cruiser.cjs:88-97` forbids reaching it via `reviews/service.ts` | Q2 · S15 |
| R49 | Queueing copies the agent row's `id` and `version` onto the batch | `:271 (AC-38)` | clear | S16 |
| R50 | The provider is resolved once per batch via `container.llm(agent.provider)` | `:273 (AC-39)` | clear | S15 |
| R51 | A `container.llm` throw → batch `failed` with the message, zero child rows, zero model calls | `:276 (AC-40)` | clear | S15 |
| R52 | Each finished case writes exactly one `eval_runs` row with batch_id, pass, three ratios, duration, cost and grounded findings in `actual_output` | `:279 (AC-41)` | clear | S13, S15 |
| R53 | A stored diff parsing to zero files → that row `pass=false`, null metrics, reason in `actual_output`, batch continues | `:282 (AC-42)` | clear | S15 |
| R54 | The batch loads the agent's enabled linked skills through the same `loadSkills` path and passes them to the engine | `:285 (AC-43)` | clear (placement decided — see `## Decisions I settled`, Q-answer 3) | S11, S15 |
| R55 | Status moves `queued`→`running`→ one terminal state, written exactly once | `:288 (AC-44)` | clear | S13, S15 |
| R56 | At most one case in flight, so at most one concurrent model call | `:291 (AC-45)` | clear | S15 |
| R57 | Scoring runs against `ReviewOutcome.review.findings` (grounded), never raw output | `:293 (AC-46)` | clear | S15 |
| R58 | `input_diff` reaches a prompt only through `reviewPullRequest`'s assembler; no prompt assembly under `modules/evals/` | `:295 (AC-47)` | clear | S15 |
| R59 | `FindingCard` renders a third control from the `evals` namespace inside `headerActions` | `:301 (AC-48)` | clear | S21, S23 |
| R60 | Activating it issues `POST /eval-cases`; `FindingActionKind` gains no member | `:304 (AC-49)` | clear | S22, S23 |
| R61 | On success it renders a confirmation and stays disabled for the page session | `:307 (AC-50)` | clear | S23 (see P2 on "page session" vs remount) |
| R62 | On failure it renders `error.message` inline and stays enabled | `:310 (AC-51)` | clear | S23 |
| R63 | A finding with neither timestamp renders the control disabled | `:312 (AC-52)` | clear | S23 |
| R64 | `TABS` gains `{ key: "evals", labelKey: "editor.tabs.evals" }` | `:317 (AC-53)` | clear | S24, S26 |
| R65 | The label resolves from the existing `agents.json` key; no second key added | `:319 (AC-54)` | clear | S24 (collapses into R64 — see P6) |
| R66 | With a completed batch the tab shows five tiles incl. `cost_usd` | `:321 (AC-55)` | clear | S25 |
| R67 | The cost tile reads the latest **completed** batch and shows a placeholder on `null` | `:323 (AC-73)` | clear | S25 |
| R68 | The tab reads the latest batch from element 0 of `GET /agents/:id/eval-runs`, never a `latest_batch` field | `:326 (AC-74)` | clear | S22, S25 |
| R69 | No completed batch → all five tiles show a placeholder, never `NaN`/`null` | `:328 (AC-56)` | clear | S25 |
| R70 | Zero cases → empty-state message and the run control disabled | `:331 (AC-57)` | clear | S25 |
| R71 | One row per case with name, kind, `expected_file` + range, and pass state from the latest batch | `:333 (AC-58)` | clear | S2, S25 |
| R72 | A `queued`/`running` batch renders progress `done/cases_total` from the event stream | `:336 (AC-59)` | clear | S22, S25 |
| R73 | "Run all evals" shows a confirmation naming N real model calls before posting | `:339 (AC-60)` | clear | S25 |
| R74 | A `queued`/`running` batch disables "Run all evals" | `:342 (AC-61)` | clear | S25 |
| R75 | Every user-facing string resolves through next-intl; no literal copy in TSX | `:344 (AC-62)` | clear | S21, S23, S25 |

## Scope
| Package | What changes | Why |
|---|---|---|
| `server/src/vendor/shared/` | `contracts/eval-ci.ts`, `contracts/knowledge.ts`, `index.ts` | R8–R10, R32–R33, R46, R71 |
| `reviewer-core/` | `src/eval/score.ts` (new), `src/grounding.ts`, `src/index.ts` | R11–R19 |
| `server/` | `db/schema/eval.ts`, `db/schema.ts`, one generated migration, a new `modules/evals/` (6 files), `modules/index.ts`, `app.ts`, `modules/skills/helpers.ts`, `modules/reviews/run-executor.ts` | R1–R7, R20–R58 |
| `client/` | `vendor/shared` mirror, `messages/en/evals.json` (new), `lib/hooks/evals.ts` (new), `FindingCard`, `AgentEditor` + a new `EvalsTab` | R10, R59–R75 |
| `e2e/`, `mcp/` | none | no flow or tool touches evals in 0019 |

## Constraints
| Constraint | Source (`path:line`) | How this plan honors it |
|---|---|---|
| C1 — Never hand-write or edit a migration; schema change → `pnpm db:generate` + `pnpm db:migrate` | `AGENTS.md` "Do not touch" | S10 is a generate step; the implementer writes `schema/eval.ts` only |
| C2 — `drizzle-kit generate` blocks on a TTY prompt when one migration both adds and drops columns | `server/INSIGHTS.md:213-217` | 0019 is additions only — one pass, no drops, no renames. If a drop is ever needed it is a second generate |
| C3 — Drizzle 0.38 `numeric()` is always a string; convert at the row↔DTO boundary | `server/INSIGHTS.md:144-148`; `reviews/repository/run.repo.ts:67,186` | S13/S12 do `Number()` on read, `String()` on write; the service and `helpers.ts` never see a string, and the decimal sum happens on strings/integers inside the repo-facing helper |
| C4 — One unpriced model nulls the whole run's cost | `reviewer-core/INSIGHTS.md:9-15` | S14 returns `null` for the batch rollup if any case is null (R23), and S25's tile is null-tolerant |
| C5 — `drizzle-orm` may be imported only from `modules/*/repository/**` | `server/.dependency-cruiser.cjs:34-44` | Only S12/S13 import drizzle; `service.ts`, `eval-run-executor.ts`, `helpers.ts`, `routes.ts` do not |
| C6 — A module may not import a sibling's `service.ts` or `repository/**`; `tsPreCompilationDeps: true` makes even a type-only import trip it | `server/.dependency-cruiser.cjs:88-97`; `server/INSIGHTS.md:472-476` | `modules/evals/` imports no sibling service/repository. It may import `modules/skills/helpers.ts`, which `reviews/run-executor.ts:16` already does |
| C7 — `helpers.ts` is this repo's *pure* extension point; the arch rule classifies by filename, not behaviour | `server/INSIGHTS.md:472-476` | S11 lifts only the pure mapper into `skills/helpers.ts`; the `skillsRepo` call stays at each call site. `modules/evals/helpers.ts` is pure rollup math only |
| C8 — Nothing reaps under `NODE_ENV=test`; the skip is load-bearing (a test boot would reap the developer's DB) | `server/src/app.ts:92-101`; `server/INSIGHTS.md:164-169`; root `INSIGHTS.md:398-404` | R44 is tested by calling `EvalService.reapOrphanedBatches()` directly; R45 is read-verified only. No boot test is written |
| C9 — Reusing `GET /runs/:id/events` means inheriting the 512-event cap and the `reply.raw.on('close')` wake | `reviews/routes.ts:27,107-112`; `server/INSIGHTS.md:183-188` | No new SSE route. S15 publishes through `RunLogger` keyed by the batch id and calls `runBus.complete(batchId)` at the terminal write |
| C10 — `registerAbort` is a `Map.set` returning an unregister closure and never throws; `cancel()` is optional-chained | `server/src/platform/sse.ts:53-59,64-67` | S15 registers per batch, unregisters in `finally` (mirroring `run-executor.ts:209-210,468`); S16's cancel needs no defensive guard |
| C11 — Only OpenRouter honours `signal`; abort stops the loop between cases, not every in-flight call | `server/INSIGHTS.md:413-421`; `reviewer-core/src/review/run.ts:144-152` | R43's guarantee is "starts no further case"; the plan does not promise an aborted in-flight HTTP call |
| C12 — A VALUE import from `@devdigest/shared` passes typecheck and vitest and still breaks `next dev`/`next build` | `client/INSIGHTS.md:83-89` | S23/S25 use `import type` only. S4's parity test is a test file, where a value import is safe |
| C13 — The vendored `Modal` renders its title in a plain `div`; `getByRole("heading")` never matches | `client/INSIGHTS.md:120-126` | R73's test queries the confirmation by text |
| C14 — `FindingCard`'s header is itself `role="button"`, so a regex name query matches it too | `client/INSIGHTS.md:126-132` | R59's test queries the new control by exact accessible name |
| C15 — A cast-based `Container`/repository stub satisfies the type and still throws at runtime when a new dependency is read | `server/INSIGHTS.md:150-155` | S16 constructs its repositories from `container.db` (precedent: `new OnboardingRepository(container.db)`, `app.ts:112`) rather than adding container getters, so no existing stub needs widening |
| C16 — `client/messages/en/*.json` is auto-registered by directory scan and ships to every route | `client/src/i18n/request.ts:17-25`; `client/INSIGHTS.md:52-58` | S21 adds one file, no shared-code edit; keep it small |
| C17 — Parallel agents share one working directory and must not run the same package's suite at once | root `INSIGHTS.md:76-83` | The execution-mode waves below are disjoint by package and never co-run a suite |
| C18 — `eval.ts:1-13`'s "reshape freely" licence expires when anything reads these tables | `server/src/db/schema/eval.ts:1-13`; spec `:65-67` | S8 rewrites that header in the same edit; the whole shape (incl. `eval_run_batches`, which only 0020 reads) lands now |
| C19 — A server test importing `test/helpers/pg.ts` must be named `*.it.test.ts` | `server/AGENTS.md` Conventions | Every DB-backed test below carries `.it.test.ts` |

## Decisions I settled (the caller's three questions)

**1. `RunLogger` event vocabulary (R47 / AC-36).** `RunEventKind` is exactly `'info' | 'tool' | 'result' | 'error'` (`server/src/platform/run-logger.ts:29-34`, typed from `@devdigest/shared`). **Add no member** — a fifth kind would change `LEVEL` and the shared contract for every existing consumer. The eval executor uses:

- batch start → `info`: `Running N eval case(s) for agent "X" (provider/model)`
- provider resolve → `runLog.step('Resolving <provider> provider', …, { kind: 'tool' })`, mirroring `run-executor.ts:215-219`
- skills → `info` with `skillsLogLine(skills)`, mirroring `run-executor.ts:246`
- **per case** → `runLog.step(\`Case k/N: <name>\`, …, { kind: 'tool' })`. `step()` emits the `…` line up front and a `done (Nms)` line after, and routes a throw to an `error` event (`run-logger.ts:75-91`) — that alone satisfies AC-36's "at least one `RunEvent` per case"
- per-case verdict → `result`: `Case k/N <name>: PASS|FAIL — recall … precision … citation …`
- engine passthrough → `onEvent: (e) => runLog.event(e.kind, e.msg, e.data)`, mirroring `run-executor.ts:294`
- terminal → `result` on done / `error` on failed or cancelled, then `this.container.runBus.complete(batchId)` (mirroring `run-executor.ts:99`), which is what ends the SSE generator.

The logger is constructed as `new RunLogger(container.runBus, [batchId], logger, { batchId, agentId })` — the single-target form, not the fan-out.

**2. Where the reap lives (R44 / AC-72).** `EvalService.reapOrphanedBatches(): Promise<number>` — **ring 3**, `server/src/modules/evals/service.ts` — delegating to `EvalBatchRepository.failOrphaned(error: string)` in **ring 4**, `modules/evals/repository/eval-batch.repo.ts`. This is exactly `ReviewService.reapOrphanedRuns()` (`reviews/service.ts:111`) over `run.repo.ts:126`, it is what AC-72's own test plan says to call (`:496`), and it keeps the unscoped `UPDATE` in the only ring allowed to hold drizzle (C5). `app.ts` (ring 4, composition root) calls `await new EvalService(container).reapOrphanedBatches()` inside the existing `if (config.nodeEnv !== 'test')` block, alongside `new ReviewService(container)` at `:103` — same construction style, same `try/catch`, same `app.log.info({ reapedBatches }, …)` shape. Putting it on the repository alone would make `app.ts` import `modules/evals/repository/**` directly, which no other reap does (`:112` constructs a repository, but `OnboardingRepository` has no service) and which reads as a layering shortcut `architecture-reviewer` would question.

**3. `loadSkills` (R54 / AC-43) — I overrule the spec's recommendation, partially.** Lifting `loadSkills` **whole** into `modules/skills/helpers.ts` puts I/O (`container.skillsRepo.enabledForAgent`) into the one file class this repo designates as pure. `pnpm arch` would stay green — its `to.path` matches only `(service|repository)` — and that is precisely the trap `server/INSIGHTS.md:472-476` records: "If you add a `helpers.ts` that is not pure, it is misnamed for this codebase and will be imported across a boundary by someone trusting the convention."

**Decision:** lift only the pure half. Add to `server/src/modules/skills/helpers.ts` (ring 1):

```ts
export function toLoadedSkills(
  rows: { id: string; name: string; version: number; body: string }[],
  countTokens: (text: string) => number,
): LoadedSkill[]
```

— it calls the existing `renderSkillBlock` and the injected counter, imports nothing new, and stays provably pure. Each executor keeps its own two-line repository call.

**Blast radius on `ReviewRunExecutor`: one private method body, nothing else.** `run-executor.ts:476-482` becomes:

```ts
private async loadSkills(workspaceId: string, agentId: string): Promise<LoadedSkill[]> {
  const rows = await this.container.skillsRepo.enabledForAgent(workspaceId, agentId);
  return toLoadedSkills(rows, (t) => this.container.tokenizer.count(t));
}
```

The call site at `:245`, the signature, the `LoadedSkill` shape and every downstream consumer (`skillsLogLine` at `:246`, the prompt-log `skills:` array at `:303-307`, `skills.map((s) => s.block)` at `:291`) are untouched. `renderSkillBlock` is already imported at `:16`, so the import line only gains a name. The existing review-path tests are the regression net; no test file needs restructuring.

If the user prefers one shared impure loader, the only placement that does not break C6 or C7 is a **new filename** — `server/src/modules/skills/skill-loader.ts` (ring 3), which the arch rule's `(service|repository)` regex does not match. That is a loophole, not a seam, and I do not recommend it.

## Steps

**Wave A — shared contracts (gates everything else).**

1. **S1** — Add to `server/src/vendor/shared/contracts/eval-ci.ts`: `EvalExpectationKind` (`z.enum(['must_find','must_not_flag'])`), `EvalBatchRecord` (the 16 fields of R9, `status` a five-member enum, `recall`/`precision`/`citation_accuracy`/`cost_usd`/`duration_ms`/`error` nullable), `EvalCaseFromFindingInput` (`{ finding_id: string, name?: string, notes?: string }`), `EvalCasePatch` (all six R33 fields optional), `EvalBatchDetail` (`{ batch: EvalBatchRecord, runs: EvalRunRecord[] }` — R46 reuses the existing `EvalRunRecord` at `:33-45`, which already carries all eight listed fields). · ring 2 · skill: `zod`, `typescript-expert` · test: `server/test/contracts-eval.test.ts` — the three AC-6 names are exported, `EvalBatchRecord.parse` accepts each of the five statuses and rejects `'paused'`, and a pre-existing `EvalCaseInput` round-trip still parses · satisfies: R8, R9, R33, R46
2. **S2** — Extend `EvalCase` in `server/src/vendor/shared/contracts/knowledge.ts:131-142` with `expectation_kind`, `expected_file`, `expected_start_line`, `expected_end_line`, `source_finding_id` (nullable), `created_at`. Additive only — nothing is renamed or removed, and nothing references `EvalCase` today. **Blocked on Q3** · ring 2 · skill: `zod` · test: covered by S1's file · satisfies: R32, R33, R71 (and the DTO R8 under-specifies)
3. **S3** — Export the new names from `server/src/vendor/shared/index.ts`. · ring 2 · skill: `zod` · test: S1's file · satisfies: R8
4. **S4** — Mirror S1–S3 into `client/src/vendor/shared/contracts/eval-ci.ts`, `contracts/knowledge.ts` and `index.ts`. Mirror the *change*, not the file — the copies have already drifted. · ring 2 · skill: `zod`, `typescript-expert` · test: `client/src/test/eval-contract-parity.test.ts` — import both copies' new schemas, assert identical `safeParse` verdicts over one valid and three invalid fixtures · satisfies: R10

**Wave B — the pure scorer (parallel with Wave C; gates S15's tests).**

5. **S5** — Export a range-intersection primitive from `reviewer-core/src/grounding.ts`. **Blocked on Q1.** Default: add `export function rangesIntersect(aStart, aEnd, bStart, bEnd): boolean` as `Math.max(min(a),min(b)) <= Math.min(max(a),max(b))` — O(1), normalises reversed pairs, and bounded for `end_line: 2_000_000_000`; refactor the existing private `rangeIntersects` (`:41-51`) to keep its `Set` iteration and delegate the comparison, so there is still one definition of "intersects". · ring 1 · skill: `onion-architecture`, `typescript-expert` · test: in S6's file — the AC-11 table (same file + overlap → match; adjacent-disjoint → no match; different file → no match; reversed start/end → match; `2_000_000_000` completes) · satisfies: R13
6. **S6** — New `reviewer-core/src/eval/score.ts`: `scoreEvalCase(input: { expectationKind, expectations: {file,startLine,endLine}[], findings: Finding[], kept: number, dropped: number }): { recall, precision, citationAccuracy, pass }`. Pure — imports only types and S5's primitive. Zero denominators return `1` (R19). · ring 1 · skill: `onion-architecture`, `typescript-expert` · test: `reviewer-core/test/eval-score.test.ts` — R14 (`0.5`), R15 (`≈0.333`), R16 (`0.75` and `1`), R17/R18 pass tables, R19 (`Number.isFinite` on all three), plus a static assertion that the module's import list contains no I/O module (R12) · satisfies: R12, R14–R19
7. **S7** — Export `scoreEvalCase` and its types from `reviewer-core/src/index.ts`, in the existing grouped-comment style. · ring 1 · skill: `typescript-expert` · test: S6's file imports from `src/index.ts`, not the deep path · satisfies: R11

**Wave C — schema + migration (parallel with Wave B; gates Wave D).**

8. **S8** — `server/src/db/schema/eval.ts`: add `evalRunBatches` (R1, `status` text enum of five, ratios `doublePrecision`, `costUsd numeric(12,6)`, `agentVersion integer`, `ranAt timestamptz defaultNow`); add `batchId` to `evalRuns` with `onDelete: 'cascade'` (R2); add `expectationKind` (text enum, `.notNull()`), `expectedFile`, `expectedStartLine`, `expectedEndLine`, `sourceFindingId` (nullable uuid, **no FK** — `findings` rows are deletable and the column is a provenance marker), `createdAt` (R3, R5); add `uniqueIndex('eval_cases_owner_source_uq').on(ownerId, sourceFindingId).where(sql\`source_finding_id is not null\`)` — the partial-index idiom, not `nullsNotDistinct()` (`server/INSIGHTS.md:138-142`) (R6). **Rewrite the file header** (`:1-17`): the "roadmap scaffolding, nothing reads it" licence is now false (C18). · ring 4 · skill: `postgresql-table-design`, `drizzle-orm-patterns`, `onion-architecture` · test: S10's · satisfies: R1–R6
9. **S9** — Add `evalRunBatches` to the `server/src/db/schema.ts` barrel (`:65,103-104`) and drop it from the ROADMAP-SCAFFOLDING note. · ring 4 · skill: `drizzle-orm-patterns` · test: S10's · satisfies: R1
10. **S10** — Run `cd server && pnpm db:generate` then `pnpm db:migrate`. Expect exactly one new file, `0022_*.sql` (latest today is `0021_jazzy_skullbuster.sql`), plus `meta/0022_snapshot.json` and a `meta/_journal.json` append. Additions only → no TTY prompt (C2). Read the emitted `.sql` before migrating. **Never hand-edit it** (C1). Note: `expectation_kind` is `NOT NULL` with no default — safe only because nothing writes `eval_cases` today (`git grep evalCases -- server/src` returns only the schema and the barrel); if a dev DB holds rows from an older seed, truncate them rather than editing the migration. · ring 4 · skill: none (generated; `server/src/db/migrations/**` is `skip` in `skill-map.json`) · tests: `server/test/evals-schema.it.test.ts` (insert a batch + case + run against the migrated DB; column set incl. `source_finding_id`/`created_at`; unknown `expectation_kind` rejected; `cost_usd` round-trips `0.000001`; a ratio accepts `0.3333333333`; two rows with the same `(owner_id, source_finding_id)` rejected while two with the same `owner_id` and null `source_finding_id` both accepted; an `eval_runs` insert with an unknown `batch_id` rejected) and `server/test/migrations-additive.test.ts` (hermetic: `meta/_journal.json`'s entries for indices 0…21 are byte-identical to a committed fixture of their tags+hashes, so an edited or reordered older migration fails) · satisfies: R1–R7

**Wave D — the server module (needs A, B, C).**

11. **S11** — Add pure `toLoadedSkills(rows, countTokens)` to `server/src/modules/skills/helpers.ts` and rewrite `ReviewRunExecutor.loadSkills` (`reviews/run-executor.ts:476-482`) to use it. See `## Decisions I settled` #3 for the exact shape and blast radius. · ring 1 (helper) / ring 3 (call site) · skill: `onion-architecture`, `typescript-expert` · test: extend the existing skills helpers unit test with a `toLoadedSkills` case (rendered block, token count, order preserved); the review path's existing tests are the regression net · satisfies: R54
12. **S12** — `server/src/modules/evals/repository/eval-case.repo.ts`: `insertFromFinding`, `listForAgent(workspaceId, agentId)` ordered `created_at DESC, id ASC`, `getScoped`, `patch`, `remove`, `countForAgent`. Catches the unique-violation SQLSTATE `23505` and surfaces it so S16 can map it to `409` (R29). · ring 4 · skill: `drizzle-orm-patterns`, `onion-architecture` · test: `server/test/evals-cases.it.test.ts` (see S20) · satisfies: R24, R29, R32–R35
13. **S13** — `server/src/modules/evals/repository/eval-batch.repo.ts`: `insertQueued`, `markRunning`, `completeTerminal` (one write — R55), `getWithRuns` (two queries max — the `## Non-functional` no-N+1 rule), `listForAgent` ordered `ran_at DESC`, `hasLiveBatch(ownerId)`, `insertCaseRun`, `failOrphaned(error)`. **`cost_usd` crosses as a string: `Number()` on read, `String()` on write** (C3). · ring 4 · skill: `drizzle-orm-patterns`, `onion-architecture` · test: S20's integration files + the repo-boundary assertion in `eval-rollup.test.ts` · satisfies: R21, R22, R37, R39, R40, R44, R46, R52, R55
14. **S14** — `server/src/modules/evals/helpers.ts` — **pure** (C7): `rollupBatch(cases, clock)` → unweighted means over non-null metrics (R20), `cases_passed` from the `pass` flags, `duration_ms` from an injected clock delta, and a **decimal** `cost_usd` sum that returns `null` if any input is null (R23) and never uses a binary-float accumulator (sum the scaled integers at 6 dp, or sum the strings digit-wise — not `+=` on floats). · ring 1 · skill: `onion-architecture`, `typescript-expert` · test: `server/test/eval-rollup.test.ts` — the spec's exact table at `:489`: three cases (scored, scored, failed-with-null-metrics) → means over two, `cases_total 3`, `cost_usd` exactly `0.000003`, fake-clock `duration_ms`; then one null cost → batch `null`, means unchanged; plus the repository hands numbers and writes a string · satisfies: R20–R23
15. **S15** — `server/src/modules/evals/eval-run-executor.ts`: the background sweep. Modelled on `ReviewRunExecutor.runOneAgent` (`run-executor.ts:162-317`) minus `loadDiff` and `agent_runs` persistence. Order: construct `RunLogger` for `[batchId]` → `registerAbort(batchId, controller)` (C10) → `markRunning` → resolve provider once (R50; a throw → batch `failed`, zero child rows, zero calls, R51) → load skills once via S11 (R54) → **sequential** `for` over cases (R56), each checking `runBus.isCancelled(batchId)` **before** starting (R43) → parse `input_diff`; zero files → write the row `pass=false`/null metrics/reason and continue (R53) → `reviewPullRequest({ systemPrompt, model, diff, llm, strategy, skills, task, onEvent, signal })` (R48, R58 — no local prompt assembly, so `wrapUntrusted` is the engine's) → `scoreEvalCase` over `outcome.review.findings` + `outcome.dropped` (R57) → write one child row (R52) → rollup via S14 and one terminal write (R55), `cancelled` if the loop exited on the flag (R43) → `runBus.complete(batchId)` → `unregisterAbort()` in `finally`. Event vocabulary exactly as pinned above (R47). · ring 3 · skill: `onion-architecture`, `security`, `typescript-expert` · test: `server/test/evals-executor.it.test.ts`, `evals-cancel.it.test.ts`, `evals-imports.test.ts` (see S20) · satisfies: R43, R47, R48, R50–R58
16. **S16** — `server/src/modules/evals/service.ts` (`EvalService`): `createCaseFromFinding` (R24–R31 — resolves the finding → its review → agent + PR, derives the kind, snapshots the diff, maps `23505` → `ConflictError`, open finding → `ValidationError`, unloadable diff → `ValidationError` naming the reason), `listCases`/`patchCase`/`deleteCase` (R32–R35), `queueBatch` (R36–R39, R49 — copies `agent.id`/`agent.version`, `422` on zero cases, `409` on a live batch, fires the executor **without awaiting**), `listBatches` (R40), `getBatch` (R46), `cancelBatch` (R41, R42 — `runBus.cancel(batchId)`), `reapOrphanedBatches` (R44). Constructs both repositories from `container.db` (C15). **Its diff source is blocked on Q2.** · ring 3 · skill: `onion-architecture`, `security`, `typescript-expert` · test: S20's files · satisfies: R24–R42, R44, R46, R49
17. **S17** — `server/src/modules/evals/routes.ts`: `POST /eval-cases` (201), `GET /agents/:id/eval-cases`, `PATCH /eval-cases/:id`, `DELETE /eval-cases/:id`, `POST /agents/:id/eval-runs` (202 + `batch_id`), `GET /agents/:id/eval-runs`, `GET /eval-runs/:batchId`, `POST /eval-runs/:batchId/cancel`. Transport only — `getContext` for the workspace, Zod contracts as the route schemas (never a hand-rolled `.parse`), no drizzle, no business logic. **A per-route rate limit on `POST /agents/:id/eval-runs`**, matching `POST /pulls/:id/review`'s `{ max: 10, timeWindow: '1 minute' }` (`reviews/routes.ts:46`) — it is the paid-LLM route, and `server/INSIGHTS.md:478-484` records a reviewer flagging exactly this omission on 0018's brief route. **No SSE route** (C9). · ring 4 · skill: `fastify-best-practices`, `onion-architecture`, `security`, `zod` · test: S20's files, plus a route-table snapshot assertion that no second SSE route was registered (R47's test) · satisfies: R24, R32–R36, R40–R42, R46
18. **S18** — Register `evals` in `server/src/modules/index.ts` (one import + one entry). · ring 4 · skill: `fastify-best-practices` · test: the existing `routes-smoke.test.ts` covers registration · satisfies: R24
19. **S19** — `server/src/app.ts`: inside the existing `if (config.nodeEnv !== 'test')` block (`:101-119`), after `OnboardingRepository.reapRunning()`, add `const reapedBatches = await new EvalService(container).reapOrphanedBatches();` with the matching `app.log.info({ reapedBatches }, …)` and a comment repeating the single-instance assumption (`:89-90`). · ring 4 · skill: `fastify-best-practices`, `onion-architecture` · test: **none — unobservable by construction** (C8); read-verified + the manual walk · satisfies: R45
20. **S20** — The server test set, all under `server/test/`:
    - `evals-cases.it.test.ts` — R24–R35 (201 + one row for an accepted and a dismissed finding; derived owner/kind/target fields; `source_finding_id`; `input_diff` unchanged after the PR's diff is mutated; open finding → 422; no loadable diff → 422 with a reason; same finding twice → 409 with the count still 1; a *different* accepted finding on the same agent → 201; list ordering over three controlled `created_at`s with an id tiebreak; `PATCH name` leaves `expected_file` intact; `DELETE` removes case + runs; a second workspace's id → 404 on GET/PATCH/DELETE and `GET /eval-runs/:batchId`)
    - `evals-runs.it.test.ts` — R36–R40, R46 (202 + `batch_id`; queued row with zero children; zero cases → 422; second POST while running → 409; once `done`, a second POST is accepted; three batches newest-first with another agent's and another workspace's absent; batch detail = batch + two entries with all eight fields)
    - `evals-executor.it.test.ts` — R47, R49–R58 (SSE subscribed before start sees ≥1 event per case + the terminal one, and a mid-batch disconnect returns the subscription count to zero; `container.llm` called once for a three-case batch; the enabled linked skill appears in every case's prompt and a disabled one does not; agent edited mid-batch does not change `agent_version`; missing key → `failed`, zero rows, zero calls; two-case batch → two complete rows, `queued`→`running`→`done` with one terminal write, never two concurrent provider calls; a model output naming a file absent from the case diff scores as a miss; a middle case with `input_diff = 'not a diff'` → that row `pass=false`/null metrics/reason, the other two scored, batch `done`)
    - `evals-cancel.it.test.ts` — R41–R43 (fake provider blocking between cases; cancel after case 1 → 200, controller aborted, provider call count stays 1, batch `cancelled`, the written row intact; cancelling a terminal batch → 409 and the row byte-identical)
    - `evals-reap.it.test.ts` — R44 (seed `running` + `queued` + `done`, call `reapOrphanedBatches()` **directly**, assert the first two are `failed` with a non-empty `error` and the third untouched). **No boot test** (C8)
    - `evals-imports.test.ts` (hermetic unit) — R48, R58 (no specifier under `server/src/modules/evals/` resolves to `reviews/run-executor` or `reviews/diff-loader`; the directory contains no `assemblePrompt`/`wrapUntrusted` call; a provider spy shows the case diff arriving inside the untrusted wrapper)
    - · skills: `typescript-expert` (`tests-ts` route) · satisfies: the `Satisfied by` column above

**Wave E — client (needs A; independent of D given stubbed fetches).**

21. **S21** — New `client/messages/en/evals.json`: the `FindingCard` control label + its confirmation + its error framing, the five tile labels, the `—` placeholder, the empty state, the run-confirmation (with an `{count}` ICU argument), the progress string, and the two expectation-kind labels. camelCase keys (C16). **No `tabs.evals` key** — that one stays in `agents.json` (R65). · ring —, client resource · skill: none (`client/messages/**` is `skip`) · test: R75's catalogue test · satisfies: R59, R65, R69, R70, R73, R75
22. **S22** — New `client/src/lib/hooks/evals.ts`: `useAgentEvalCases(agentId)`, `useAgentEvalBatches(agentId)` (R68 — the tab reads element 0), `useEvalBatch(batchId)`, `useCreateEvalCase()`, `useRunEvals(agentId)`. Progress (R72) reuses the existing `useRunEvents([batchId])` (`client/src/lib/hooks/reviews.ts:189`) — the same `EventSource` over `/runs/:id/events`, no new hook family. · client · skill: `react-best-practices`, `react-code-organization`, `next-best-practices`, `security`, `typescript-expert` · test: exercised through S23/S25's component tests · satisfies: R60, R68, R72
23. **S23** — `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`: a third `Button` inside the existing `headerActions` div (`:95-116`), disabled when `!f.accepted_at && !f.dismissed_at` (R63), wired to `useCreateEvalCase` (R60 — `FindingActionKind` untouched), with local state for the success confirmation + disable (R61) and the API envelope's `error.message` inline on failure (R62). `import type` only from the contracts (C12). · client · skill: `react-best-practices`, `react-code-organization`, `next-best-practices`, `security`, `typescript-expert` · test: `FindingCard.test.tsx` (create or extend) — the control renders inside `headerActions`; activating it issues one `POST /eval-cases` and **no** finding-action request; success → confirmation + disabled; a 422 envelope → `error.message` inline, still enabled; an open finding → disabled; plus a static assertion that `FindingActionKind`'s members are exactly `accept, dismiss, learn, reply`. Query the new control by **exact** accessible name (C14) · satisfies: R59–R63, R75
24. **S24** — `client/src/app/agents/[id]/_components/AgentEditor/constants.ts:10-14`: add `{ key: "evals", labelKey: "editor.tabs.evals", icon: <IconName> }` and update the "Evals/Stats/CI stay hidden" comment to name only Stats/CI. · client · skill: `react-code-organization`, `typescript-expert` · test: `AgentEditor.test.tsx` — `TABS` contains the entry, the rendered label equals `agents.json`'s `editor.tabs.evals`, and no `*.tabs.evals` key exists in `evals.json` · satisfies: R64, R65
25. **S25** — New `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/` with `EvalsTab.tsx`, `EvalsTab.test.tsx`, `styles.ts`, `helpers.ts`, `constants.ts`, `index.ts` (the `SkillsTab` sibling is the exact precedent). Five tiles from the latest **completed** batch (R66, R67, R69); the case list with name, kind, `expected_file:start-end` and pass state, truncating rather than overflowing (R71 + `## Non-functional` Layout); empty state + disabled run control on zero cases (R70); a confirmation naming N before posting (R73); progress `k/cases_total` and a disabled run control while live (R72, R74). Pass state is text as well as colour (WCAG 1.4.1). `import type` only (C12). · client · skill: `react-best-practices`, `react-code-organization`, `next-best-practices`, `security`, `typescript-expert` · test: `EvalsTab.test.tsx` — the spec's fixture table at `:507-509`, with the batch list **stubbed out of chronological order** to prove element 0 is used, a `cancelled`-newest / `done`-older negative control for R67, the confirmation queried **by text, not `getByRole("heading")`** (C13), and an empty-catalogue render where every string becomes a missing-key marker (R75) · satisfies: R66–R75
26. **S26** — `AgentEditor.tsx`: render `<EvalsTab agentId={…} />` on `tab === "evals"` alongside the existing `config`/`skills` branches (`:28`). · client · skill: `react-best-practices`, `react-code-organization` · test: S24's file · satisfies: R64

## Skills for the implementer
| Path (glob) | Skills | What they will require here |
|---|---|---|
| `server/src/db/schema/eval.ts`, `server/src/db/schema.ts` | `postgresql-table-design`, `drizzle-orm-patterns`, `onion-architecture`, `security`, `typescript-expert` | money as `numeric`, ratios as `doublePrecision`, a partial unique index rather than `nullsNotDistinct()`, cascade on the child FK |
| `server/src/modules/evals/repository/*.repo.ts` | `drizzle-orm-patterns`, `onion-architecture`, `security`, `typescript-expert` | the only files here allowed to import drizzle; the `numeric` string↔number boundary; `getWithRuns` in ≤2 queries |
| `server/src/modules/evals/routes.ts` | `fastify-best-practices`, `onion-architecture`, `security`, `typescript-expert`, `zod` | contracts as route schemas, no drizzle, no logic, a per-route rate limit on the paid route |
| `server/src/modules/evals/{service,eval-run-executor,helpers,constants}.ts`, `server/src/modules/skills/helpers.ts`, `server/src/modules/reviews/run-executor.ts` | `onion-architecture`, `security`, `typescript-expert` | ring 3 may not import a sibling's service/repository; `helpers.ts` must stay pure |
| `server/src/app.ts` | `fastify-best-practices`, `onion-architecture`, `security`, `typescript-expert` | the reap goes inside the existing non-test block, not beside it |
| `reviewer-core/src/**` | `onion-architecture`, `typescript-expert`, `security` | no DB/GitHub/filesystem; the engine's only side effect is the injected `LLMProvider` |
| `{server,client}/src/vendor/shared/**` | `zod`, `typescript-expert` | additive exports only; snake_case contract fields |
| `client/src/**/*.tsx` (not vendor, not tests) | `react-best-practices`, `react-code-organization`, `next-best-practices`, `security`, `typescript-expert` | the `_components/<PascalCase>/` layout with its five sibling files; `import type` from the contracts |
| `client/**/*.test.tsx` | `react-testing-library` | query by accessible name/text, not by implementation detail |
| `{server,reviewer-core}/test/**` | `typescript-expert` | — |
| `server/src/db/migrations/**`, `client/messages/**` | **none** — `skip` in `skill-map.json` | never sent to a reviewer |
| any file importing `zod` | `zod` | content route, union with the above |

## Verification
| Package | Command | What counts as pass |
|---|---|---|
| `reviewer-core/` | `cd reviewer-core && npm run typecheck` · `npm run lint` · `npm test` | exit 0, no new warnings |
| `server/` | `cd server && pnpm typecheck` · `pnpm lint` (eslint + `pnpm arch`) · `pnpm exec vitest run --exclude '**/*.it.test.ts'` | exit 0; **`pnpm arch` reports 0 errors** — `no-cross-module-internals` is the one most likely to fire here |
| `client/` | `cd client && pnpm typecheck` · `pnpm lint` · `pnpm test` | exit 0 |
| `server/` (cross-package) | the same three, re-run after any `reviewer-core/` or `src/vendor/shared/` edit | required by root `AGENTS.md` |
| `server/` **(the user, not an agent)** | `cd server && pnpm exec vitest run .it.test` | exit 0, **`skipped: 0`**, and no FAIL in a file this change does not touch. A non-zero `skipped` is not a pass (`server/INSIGHTS.md:108-112,250,287,301`) |
| root **(the user)** | `./scripts/e2e.sh` | the UI changed (a new tab, a new `FindingCard` control), so run it. Read the exit code, do not pipe through `tail` (`e2e/INSIGHTS.md:76`), and note "N/N passed" counts only *eligible* flows (`e2e/INSIGHTS.md:101`) |
| root **(the user)** | `/pr-self-review` before any push | manual-only; any `CRITICAL` blocks |
| root **(the user)** | the two manual walks at `specs/0019-evals.md:510-511` | the second one is **the only exercise R45/AC-75 can ever get**, and the first is the feature's real deliverable |

Steps that stay implemented-but-unverified until the user runs the Docker lane: **S12, S13, S15, S16, S17 and S19** — every `.it.test.ts` file in S20. The implementer can run S6's, S14's, S20's `evals-imports.test.ts`, `migrations-additive.test.ts` and `contracts-eval.test.ts`, and the whole client suite, and nothing else that touches Postgres.

**S10 needs a live database.** `pnpm db:generate` does not, but `pnpm db:migrate` does. If the implementer's environment has no Docker Postgres, S10 splits: generate + read the `.sql` (agent), migrate (user), and every `.it.test.ts` is then also the user's.

## Recommendations
| ID | Proposal | Why (`path:line`) | Cost if adopted | If declined |
|---|---|---|---|---|
| P1 | Add two acceptance criteria to 0019 via `spec-creator`: one for the eval-case **DTO** shape the routes return (the six new `EvalCase` fields), one for the `PATCH` input and the batch-detail envelope | AC-6 (`:145`) names three exports, but AC-27/28/35/58 cannot be satisfied with them — `EvalCase` (`knowledge.ts:131-142`) has no expectation fields, and AC-8's "no other change" forbids the matching client mirror | 0 new steps — S1/S2/S4 already do the work; the cost is one `spec-creator` round and a `check-specs.sh` re-run | S2 and the `knowledge.ts` half of S4 ship as work no criterion names, and `plan-verifier` will flag them as unplanned diff |
| P2 | Lift the "already an eval case" disable out of `FindingCard`'s local state into the TanStack query cache, keyed by finding id | AC-50 (`:307`) says "for the remainder of the page session", but component-local state resets on remount — and the PR-detail list remounts cards on filter changes. AC-67's `409` is the real backstop | +1 step, ~20 lines in S22, no new file | S23 ships local state; the component test passes, and a user who filters the list sees the control enabled again. The second click then gets a clean `409` (R29), so the data stays correct |
| P3 | Add a partial unique index on `eval_run_batches (owner_id) where status in ('queued','running')` in the same migration | The spec concedes AC-34's guard is a racy read-then-write (`:367`) and that the cost is double spend. The index is free *now* (C18) and a second migration later | +3 lines in S8, +1 assertion in S10's test | The race stays open, as the spec decided. Cost is money, not corruption |
| P4 | Drop AC-5 as an acceptance criterion; keep it as a review-checklist line | AC-5 (`:139`) constrains the *diff*, not the product, and its own test plan (`:480`) substitutes a journal-hash proxy because `git diff --name-status` is a reviewer action | 0 steps; `migrations-additive.test.ts` is worth keeping either way | The criterion stays and is satisfied by a proxy test, which is honest but mismatched to its wording |
| P5 | Restate AC-10's test from "the suite has no provider stub registered for this file" to a static import assertion over `score.ts` | AC-10 (`:161`) as written is unfalsifiable — the absence of a stub proves nothing about the function | 0 steps; S6's test already does the static assertion | The weaker test ships alongside the real one |
| P6 | Collapse AC-53 and AC-54 into one criterion | Both (`:317`, `:319`) assert the same `TABS` entry from two angles; one step satisfies both and `plan-verifier` will enumerate two items for one line of code | 0 steps | Harmless duplication in the audit trail |

## Clarification needed

**Blocked:** R8, R10, R13, R27, R31, R48

1. **AC-11's `rangeIntersects` reuse.** The function is **private** to `grounding.ts` and its signature is `(lines: Set<number>, start, end)` — a *set-vs-range* test. Expectation-vs-finding matching is *range-vs-range*. Reusing it literally means materialising one range into a `Set`, which reintroduces exactly the unbounded iteration its own comment exists to prevent (`grounding.ts:41-51`) and would hang on AC-11's own `end_line: 2_000_000_000` test case. — *default:* export a new O(1) `rangesIntersect(aStart,aEnd,bStart,bEnd)` from `grounding.ts` and refactor the private `rangeIntersects` to delegate to it, so there is still one definition of "intersects" and nothing in the review path changes behaviour · *cost of the other choice:* a `Set` round-trip that is slower, unbounded, and fails the criterion's own test. Unblocks R13.
2. **AC-37 bans `reviews/diff-loader.ts` directory-wide, but AC-24/AC-26 require it.** The Inputs table (`:433`) names `loadDiff` as the diff's provenance, and AC-26's edge case (`:370`) depends on its `pr_files` fallback. `evals/service.ts` cannot reach it via `reviews/service.ts` either — `.dependency-cruiser.cjs:88-97` makes that an `error`. — *default:* read AC-37's ban as governing the **executor** (`eval-run-executor.ts`), which is its stated rationale, and let `evals/service.ts` import `loadDiff` from `reviews/diff-loader.ts` for case creation only; the import test in S20 then asserts the ban on `eval-run-executor.ts` specifically · *cost of the other choice:* either lift `loadDiff` to `modules/_shared/diff-loader.ts` behind a structural `{ getPrFiles }` port (a refactor of a live review path, ~2 extra steps, and `reviews/run-executor.ts:105` changes), or duplicate only the `pr_files` reconstruction in `evals/`, which silently drops the primary `git diff` path AC-26's edge case assumes. Unblocks R27, R31, R48.
3. **The contract surface is three names short.** The routes must return `expectation_kind`, `expected_file`, `expected_start_line`, `expected_end_line`, `source_finding_id` and `created_at` (AC-27, AC-28, AC-35, AC-58), and `EvalCase` (`knowledge.ts:131-142`) carries none of them. AC-6 names three new exports; AC-8 says the client copy carries "no other change". — *default:* extend `EvalCase` in `knowledge.ts` **additively** (nothing is renamed or removed, and nothing references it today), add `EvalCasePatch` and `EvalBatchDetail` to `eval-ci.ts`, and mirror both files into the client copy; file P1 so the spec catches up · *cost of the other choice:* a parallel `EvalCaseRecord` in `eval-ci.ts` that leaves `EvalCase` as dead scaffolding a second time, and `knowledge.ts` untouched so AC-8 reads literally. Unblocks R8, R10.

**If you just say "go with the defaults":** I issue this plan unchanged — 26 steps, `rangesIntersect` exported from `grounding.ts`, `evals/service.ts` importing `loadDiff` while `eval-run-executor.ts` does not, and `EvalCase` extended in both contract copies — and P1 goes to `spec-creator` as a follow-up rather than a blocker.

## Out of scope
| Not in this plan | Why | Who owns it |
|---|---|---|
| The `/evals` dashboard page, its nav entry and `g e` shortcut | spec 0019 `:71-73` — 0020. `client/src/components/app-shell/helpers.ts:35` keeps resolving `/eval*` to a nav item that does not exist | spec 0020 |
| Trend charts, `EvalTrendPoint`, `EvalDashboard`, the compare modal and the prompt diff | `:74-77` | spec 0020 |
| The manual Case Editor and hand-written case bodies | `:78-80` — `PATCH` here renames and fixes expectations only | spec 0020 |
| Skill-owned cases, `GET /skills/:id/eval-cases`, flipping `SkillDetail/constants.ts:8` | `:81-83` — every 0019 row is `owner_kind='agent'` | spec 0020 |
| `GET /agents/:id/eval-dashboard`, `GET /eval-dashboard` | `:84` | spec 0020 |
| The `evals/` harness-plane package and the Stryker run against the scorer | `:85-87` — touch no product code | separate tasks |
| An automated test for R45 (AC-75) | Unobservable: the call lives inside `if (config.nodeEnv !== 'test')` and the skip is load-bearing (C8). The spec concedes this at `:352-354` | read-verification + the user's manual restart walk (`:511`) |
| A hard cap on `cases_total` | A recorded decision, not an omission (`:101`) | a later spec, no contract change needed |
| Closing the two-concurrent-batches race | Decided out at `:367`; offered as P3 | the user, if P3 is accepted |
| Architecture review, correctness review, coverage backfill | Separate agents on the same diff; `/pr-self-review` is **the user's** to run | `architecture-reviewer`, `/code-review`, `test-writer`, the user |

## Not found
| Looked for | How (verbatim command) | Conclusion | What would settle it |
|---|---|---|---|
| An existing `FindingCard.test.tsx` | `git ls-files 'client/src/app/agents/[id]/_components/'` (listed the agents tree only) | **inconclusive** — I did not list the `FindingCard` directory. S23 says "create or extend" | `Glob client/src/app/repos/**/FindingCard/*` |
| The canonical home for a cross-copy contract parity test | `git ls-files client/src/lib/hooks/ client/messages/en/` | **inconclusive** — I proposed `client/src/test/eval-contract-parity.test.ts` from the `skill-map.json` exclude `client/src/test/**`, which implies the directory exists, but I did not list it | `Glob client/src/test/*` |
| Whether `EvalCase`/`EvalRun`/`EvalRunRecord` are referenced anywhere today | relied on the spec's own measured claim (`:24-27`) and on `git grep -n 'evalCases\|evalRuns' -- server/src` (schema + barrel only) | the **tables** are confirmed unreferenced; the **contracts** are asserted unreferenced by the spec, not re-verified by me | `Grep "EvalCase\|EvalRunRecord" server/src client/src` |
| How far `client/src/vendor/shared/contracts/knowledge.ts` has drifted from the server copy | file confirmed to exist (`git ls-files client/src/vendor/shared/contracts/`) | **inconclusive** — S4 says "mirror the change, not the file", which is the safe instruction either way | `Read` both copies' `// ---- Eval ----` sections side by side |
| An icon name for the new Evals tab | `AgentEditor/constants.ts` shows `"Settings"` and `"Sparkles"`, typed `IconName` | **not chosen** — S24 leaves it as `<IconName>` | `Grep "export type IconName" client/src/components/` |
| Whether the dev database holds legacy `eval_cases` rows that would reject a `NOT NULL` add | `git grep -n 'evalCases' -- server/src` (no seed writer today) | low risk, but **unverified on a live DB** | `psql … -c 'select count(*) from eval_cases'` before S10's `db:migrate` |

## Execution mode

**Recommendation: multi-agent.** 26 steps across three packages (plus two vendored contract copies), two of which — server and client — are independent once the contracts land, and a test surface large enough that the fresh-eyes property is worth a handoff. One context would have to hold the onion rings, drizzle's `numeric` boundary, Fastify route conventions, the React `_components/` layout, next-intl and `react-testing-library` at once — seven or more skills.

**Multi-agent decomposition** (base ref for every reviewer: **`origin/main`**, never `HEAD`)

| Wave | Agent | Steps | Runs in parallel with | Handoff artifact |
|---|---|---|---|---|
| 1 | `implementer` (contracts) | S1–S4 | — | Both `vendor/shared` copies + `contracts-eval.test.ts` + `eval-contract-parity.test.ts` green |
| 2a | `implementer` (engine + schema) | S5–S10 | 2b | `reviewer-core` green; `0022_*.sql` generated and migrated; `evals-schema.it.test.ts` written (run by the user) |
| 2b | `implementer` (client) | S21–S26 | 2a | `client` typecheck + lint + `pnpm test` green |
| 3 | `implementer` (server module) | S11–S20 | — | `server` typecheck + lint + unit suite green; the six `.it.test.ts` files written but **not run** |
| 4 | **`plan-verifier`** (gate) | — | — | Step-by-step Present/Missing/Contradicted over the full diff vs this plan. A `Missing` or `Contradicted` goes back to the owning implementer and **wave 5 does not run** |
| 5 | `architecture-reviewer` ∥ `/code-review` (the user) ∥ `test-writer` | — | each other, same diff | Layering verdict · correctness verdict · coverage backfill |
| 6 | `plan-verifier` (delta) | — | — | Only if `test-writer` added files |

Waves 2a and 2b are safe to co-run: their file sets are disjoint (`reviewer-core/src`, `reviewer-core/test`, `server/src/db` vs `client/`) and they run different package suites, so neither C17's shared-working-directory hazard nor a suite collision applies. **Wave 3 is sequential after both** — it imports `scoreEvalCase` (2a), reads the migrated schema (2a), and shares the `server/` suite with 2a's `pnpm db:migrate`. Running 3 beside 2a would mean two agents in `server/`, which C17 forbids.

Test ownership, so no two agents write the same file: each `implementer` writes the tests its own steps name. `test-writer` backfills **only** `server/test/evals-cases.it.test.ts`'s negative paths and `EvalsTab.test.tsx`'s empty-catalogue case — the two places where a reader who did not write the code is worth the handoff — and may run **only the one file it wrote**, never the full `.it.test` lane.

**Single-agent decomposition**
S1 → S2 → S3 → S4 → S5 → S6 → S7 → S8 → S9 → S10 → S11 → S12 → S13 → S14 → S15 → S16 → S17 → S18 → S19 → S20 → S21 → S22 → S23 → S24 → S25 → S26, in one context, loading: `zod` + `typescript-expert` before S1; `onion-architecture` before S5; `postgresql-table-design` + `drizzle-orm-patterns` before S8; `onion-architecture` + `fastify-best-practices` + `security` before S11; `react-best-practices` + `react-code-organization` + `next-best-practices` + `react-testing-library` before S21.

**Cost of the mode I recommend:** one extra handoff boundary at wave 1 (the contracts must be exactly right before two agents build on them, and a late contract change invalidates both), plus a forced serialisation of wave 3 behind 2a — so multi-agent buys parallelism on roughly a third of the work, not on all of it, and buys fresh-eyes review on all of it.

**This is a recommendation, not a choice.** The main session must put it to the user with `AskUserQuestion` before implementation starts.
