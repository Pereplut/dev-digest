---
title: Evals — regression harness for reviewer agents
status: done
lesson: L06
packages: [server, client, reviewer-core]
---

## Problem & why

Every accept/dismiss click in DevDigest throws away the only labelled data the product has. A
reviewer accepting a finding has just asserted "this agent was right about `file:line`"; dismissing
one asserts "it should not have flagged this". Those two assertions are exactly the dataset a
regression net needs, and today they end their life as two timestamp columns
(`findings.accepted_at` / `findings.dismissed_at`) read only by the findings list. Changing an
agent's system prompt, model or linked skill is therefore unmeasurable: there is no before/after,
only an impression.

The parts to answer it are already built and inert:

- `eval_cases` and `eval_runs` exist as tables — `server/src/db/schema/eval.ts:24-55`, created in
  `server/src/db/migrations/0000_init.sql:116-141`. **Nothing in `server/src` reads or writes
  either** outside the schema barrel and `db/seed.ts` (the file's own header says so at
  `eval.ts:1-13`).
- `EvalCaseInput`, `EvalRunRecord`, `EvalRunResult`, `EvalTrendPoint`, `EvalDashboard` are defined
  at `server/src/vendor/shared/contracts/eval-ci.ts:20-89` and **referenced by nothing**. So are
  `EvalRun`, `EvalCase`, `EvalOwnerKind`, `EvalPerTrace`
  (`server/src/vendor/shared/contracts/knowledge.ts:108-143`).
- The Agent editor reserves an Evals tab it never renders —
  `client/src/app/agents/[id]/_components/AgentEditor/constants.ts:10-14` ("Evals/Stats/CI stay
  hidden until built") — and the i18n label `editor.tabs.evals` already exists in
  `client/messages/en/agents.json`.
- The grounding gate already produces the exact numerator and denominator a citation-accuracy
  metric needs: `groundFindings()` returns `{ kept, dropped }`
  (`reviewer-core/src/grounding.ts:57-89`) and `ReviewOutcome.dropped` carries it out of the engine
  (`reviewer-core/src/review/run.ts:161`).
- The engine entry point is already PR-row-free: `reviewPullRequest(input)`
  (`reviewer-core/src/review/run.ts:188`) takes a plain `UnifiedDiff` plus an injected `llm`, so a
  stored diff can be replayed through the real agent with no GitHub call.

What is missing is one honest schema gap and the wiring: `eval_runs` is **per case** with no batch
identity and no agent identity, so "one sweep of the whole set by one agent version" — the unit
every metric comparison is made of — cannot be expressed. The cost of leaving it: the product can
record a decision but cannot tell whether acting on it made the reviewer better or worse.

## Goals / Non-goals

**Goals**

- An eval case is **born from a real finding**: one click on a finding turns it into
  `must_find <file>:<start>-<end>` (accepted) or `must_not_flag <file>:<start>-<end>` (dismissed),
  with the PR's diff snapshotted as the case input.
- A **batch run**: `POST /agents/:id/eval-runs` replays every case of one agent through that
  agent's real provider, model, system prompt and linked skills, scores each case, and rolls the
  per-case numbers into one batch row carrying the agent version that produced them.
- **Scoring is pure code in `reviewer-core`** — recall, precision, citation accuracy and a per-case
  pass, all computable without Postgres and without a model.
- A **batch is watchable and stoppable**: progress streams over the existing `runBus` so the Evals
  tab shows the sweep as it happens, exactly as a review run does, and a running batch can be
  cancelled before the next case spends money.
- A **batch is findable**: `GET /agents/:id/eval-runs` lists an agent's batches newest first. The
  Evals tab reads the first row; 0020's dashboard and compare modal consume the same route rather
  than a second one.
- An **Evals tab in the Agent editor**: metric tiles including the last run's cost, the case list
  with per-case pass state, and "Run all evals".
- The schema lands **whole** — `eval_run_batches` included — even though most of its columns are
  read by spec 0020. The licence in `eval.ts:1-13` to reshape these tables freely expires the
  moment this spec ships.

**Non-goals** — each of these is spec 0020, not an omission:

- **The Eval Dashboard page** (`/evals`), its nav item in `client/src/vendor/ui/nav.ts` and its
  `g e` shortcut. `client/src/components/app-shell/helpers.ts:35` already resolves `/eval*` to a
  nav item that does not exist; it stays that way after 0019.
- **Trend charts.** No consumer of `client/src/vendor/ui/charts/LineChart.tsx` is added, and
  `EvalTrendPoint` / `EvalDashboard` stay unreferenced by any route.
- **The compare-two-runs modal** and the system-prompt diff between agent versions. 0019 *stores*
  `agent_version` on every batch so 0020 can diff them; it renders no comparison.
- **The manual Case Editor.** In 0019 the only way to create a case is from an existing finding;
  there is no hand-written-diff form, and `PATCH /eval-cases/:id` exists for renaming and fixing an
  expectation, not for authoring a new case body.
- **Skill-owned cases.** `owner_kind` keeps both members and every row 0019 writes is
  `owner_kind='agent'`. `GET /skills/:id/eval-cases` is not added and
  `SkillDetail/constants.ts:8` (`shipped: false`) is not flipped.
- **Dashboard aggregate routes** `GET /agents/:id/eval-dashboard` and `GET /eval-dashboard`.
- Also outside both specs, because they touch no product code: the harness-plane `evals/` package
  (skill evals via the Claude Agent SDK) and the one-off Stryker mutation-testing run against the
  scorer. Those are tracked as their own tasks.

## Decisions

| Question | Decision | Consequence |
|---|---|---|
| How does a case produce output? | **Real LLM calls only** — each case re-runs the agent through its configured provider. No mock or replay engine. | A batch of N cases is N real model calls and N real charges; metrics are not reproducible run-to-run; every test of the executor must inject a fake `LLMProvider` (`container.llm` is already an adapter port). Spend has to be surfaced in the UI before the user clicks (AC-60). |
| How does the user watch a run? | **Background execution + SSE**, reusing `container.runBus` through `RunLogger`, keyed by the batch id. | No new SSE route: `GET /runs/:id/events` (`server/src/modules/reviews/routes.ts:65-67`) subscribes by id with no DB lookup, so a batch id streams through it unchanged. A batch therefore shares the 512-event backpressure ceiling (`routes.ts:27`). |
| Who owns cases? | **Agents and skills** — `owner_kind` already admits both (`eval.ts:29`) — but **0019 ships agents only**. | No migration is needed when 0020 adds skill-owned cases; every 0019 row is `owner_kind='agent'` and routes are agent-scoped. |
| Reuse `ReviewRunExecutor`? | **No** — a new `run-executor.ts` calls `reviewPullRequest` directly. | `ReviewRunExecutor` is coupled to a real `PullRow` through `loadDiff` (`server/src/modules/reviews/diff-loader.ts:12-19`) and to `agent_runs` persistence; an eval case has a stored diff and no PR row. The duplication is the agent/skill/provider resolution block (`run-executor.ts:215-246`), which is the deliberate cost. `architecture-reviewer` will ask: the engine call and the scorer stay pure, the executor stays in the service ring. |
| Sharing `loadSkills` | **Lift only its pure half.** `toLoadedSkills(rows, countTokens)` goes into `modules/skills/helpers.ts` (ring 1); each executor keeps its own two-line `container.skillsRepo.enabledForAgent` call (AC-43). This overrules this spec's earlier recommendation to move the method whole, and the user accepted the overrule. | Lifting the whole six lines (`run-executor.ts:476-482`) would put I/O into the file class this repo designates as pure — and `pnpm arch` cannot catch it, because the rule's `to.path` matches only `(service\|repository)`. That is exactly the trap recorded at `server/INSIGHTS.md:472-476`: a `helpers.ts` that is not pure is misnamed here and will be imported across a boundary by someone trusting the convention. Blast radius on the review path is one private method body; the call site, signature, `LoadedSkill` shape and every downstream consumer are untouched. |
| Where `loadDiff` may be imported | **Split by file, not by directory.** `evals/service.ts` imports `loadDiff` from `reviews/diff-loader.ts` for case creation; `run-executor.ts` imports neither it nor `reviews/run-executor.ts` (AC-37). | The directory-wide ban this spec first wrote was self-contradictory: AC-24 and AC-26 require `loadDiff`, AC-26's edge case depends on its `pr_files` fallback, and `.dependency-cruiser.cjs:88-97` makes reaching it through `reviews/service.ts` an `error`. The ban's rationale was always about the **executor** — a replayed case must not re-enter the PR-coupled review path — so that is what it now governs. The alternative, lifting `loadDiff` into `modules/_shared/` behind a `{ getPrFiles }` port, is a refactor of a live review path for no behavioural gain in 0019. The import test targets the executor file. |
| The two-concurrent-batches race | **Closed in the database** — a partial unique index on `eval_run_batches (owner_id) where status in ('queued','running')` (AC-76). This reverses the earlier decision to leave the race open. | AC-34's read-then-write guard is now backed by a constraint: two simultaneous `POST /agents/:id/eval-runs` cannot both create a live batch, because the second insert fails at the database and the route maps that to the same `409 conflict` the guard returns. The cost is three lines in the same migration, taken now because a later one would run against live tables. Without it the race cost real money (two full sweeps), which is why "double spend, not corruption" was the wrong thing to accept. |
| Where the reap lives | **`EvalService.reapOrphanedBatches()` (ring 3) delegating to `EvalBatchRepository.failOrphaned()` (ring 4)**, mirroring `ReviewService.reapOrphanedRuns()` (`reviews/service.ts:111` over `run.repo.ts:126`). | `app.ts` constructs the **service** inside its existing non-test block (AC-75), exactly as it does at `:103`. Putting the sweep on the repository alone would make the composition root import `modules/evals/repository/**` directly, which reads as a layering shortcut; keeping the unscoped `UPDATE` in ring 4 is what the dependency rule requires of anything holding drizzle. |
| Batch identity | A **parent table `eval_run_batches`**, not extra columns on `eval_runs`. | One row per sweep carries the rolled-up metrics, the agent version and the status machine; `eval_runs` stays per case with a cascading `batch_id`. Denormalising instead would repeat agent/version/status on every case row and make "the latest batch" a group-by. |
| A finding that is neither accepted nor dismissed | **Refuse it** — the control is disabled and the route rejects with `422` (AC-25, AC-52). | Creating a case costs one extra decision (accept or dismiss first). Defaulting an open finding to `must_find` would store an expectation the user never asserted — silently wrong labelled data, which is the exact failure this feature exists to detect. |
| `eval_cases` shape | **Add `source_finding_id` (nullable uuid) and `created_at` in this migration**, plus a unique index on `(owner_id, source_finding_id)` partial on `source_finding_id IS NOT NULL`. | The double-click/reload duplicate is closed in the database (AC-67), not only by the client's session-scoped disable (AC-50); AC-27 orders by `created_at DESC` instead of by name; hand-written cases (0020) keep `source_finding_id` null and are unconstrained by the index; 0020 can render an "already an eval case" badge without a new column. Taken now because `eval.ts:1-13`'s licence to reshape these tables expires the moment 0019 ships. |
| Cancellation | **In 0019**: `POST /eval-runs/:batchId/cancel` over `runBus.registerAbort` (the pattern `ReviewRunExecutor` uses at `run-executor.ts:209-210`), plus a startup reconciliation that fails orphaned batches. | `status` gains a fifth member, `cancelled` (AC-7, AC-44). Without the startup sweep a process restart would leave a batch `running` forever and AC-34 would make that agent permanently unrunnable. The sweep has precedent — `buildApp` already reaps stale `agent_runs`, abandoned jobs and stale onboarding generations in one non-test block (`server/src/app.ts:101-112`) — and inherits both of that block's properties: the single-API-instance-per-database assumption (`:89-90`) and the `NODE_ENV=test` skip (`:92-101`), which is why AC-72 is asserted against the method and AC-75 against the file. |
| Spend ceiling | **No hard cap** on `cases_total`. The confirmation names N (AC-60) and the Evals tab shows the previous batch's `cost_usd` (AC-73). | Read this as a decision, not an omission: an operator can start a 300-case sweep. The two guards are informational — what the next run will cost in calls, and what the last one actually cost in dollars. A cap can be added later without a contract change. |
| Finding the latest batch | **`GET /agents/:id/eval-runs`**, batches newest first; the tab reads the first row. | 0019 ships no dashboard aggregate, and the alternative — a `latest_batch` field on the case-list response — would couple two unrelated reads and be dead weight the moment 0020's dashboard needs the full list. 0020's dashboard and compare modal consume this same route. |

## User stories

- As a **reviewer**, I want to turn a finding I just accepted or dismissed into an eval case in one
  click, so that my judgement becomes a regression test instead of a timestamp.
- As an **agent author**, I want to run every case of an agent and see recall, precision and
  citation accuracy, so that editing a system prompt or swapping a model becomes a measurable
  before/after rather than an impression.
- As an **agent author**, I want to watch a batch progress case by case, so that a long sweep over
  real model calls is not a spinner I have to trust.
- As an **operator paying for tokens**, I want to be told how many real model calls a run will make
  before it starts and what the last run cost, so that I never trigger an unbounded spend by
  clicking a button.
- As an **operator paying for tokens**, I want to stop a sweep that is already running, so that a
  misconfigured agent does not spend its way through every remaining case.

## Acceptance criteria (EARS)

**Schema and migration**

- **AC-1** — The server schema shall define an `eval_run_batches` table with the columns `id`,
  `workspace_id`, `owner_kind`, `owner_id`, `agent_id`, `agent_version`, `ran_at`, `status`,
  `error`, `recall`, `precision`, `citation_accuracy`, `cases_total`, `cases_passed`,
  `duration_ms`, `cost_usd`.
- **AC-2** — The server schema shall give `eval_runs` a `batch_id` column referencing
  `eval_run_batches.id` with `onDelete: 'cascade'`.
- **AC-3** — The server schema shall give `eval_cases` the columns `expectation_kind` (enum
  `must_find` | `must_not_flag`, NOT NULL), `expected_file`, `expected_start_line` and
  `expected_end_line`.
- **AC-4** — The server schema shall type every ratio column on `eval_runs` and `eval_run_batches`
  as `doublePrecision` and both `cost_usd` columns as `numeric(12,6)`.
- **AC-63** — The server schema shall give `eval_cases` a nullable `source_finding_id` column and a
  `created_at` timestamp column defaulting to `now()`.
- **AC-64** — The server schema shall define a unique index on `eval_cases (owner_id,
  source_finding_id)` partial on `source_finding_id IS NOT NULL`, so rows with a null
  `source_finding_id` are unconstrained by it.
- **AC-76** — The server schema shall define a unique index on `eval_run_batches (owner_id)` partial
  on `status IN ('queued','running')`, so a second concurrent live batch for one owner is rejected
  by the database.

*(The migration-is-additive rule is no longer an acceptance criterion. It constrains the diff rather
than the product, so it has moved to `## Non-functional` as a review-checklist line; the
`migrations-additive.test.ts` guard stays, under the schema row of `## Test plan`. The retired id is
dead and is never reused.)*

**Shared contracts**

- **AC-6** — `@devdigest/shared` shall export `EvalExpectationKind`, `EvalBatchRecord` and
  `EvalCaseFromFindingInput` from `contracts/eval-ci.ts` through the barrel, with no existing export
  renamed or removed.
- **AC-7** — `EvalBatchRecord` shall carry snake_case fields `id`, `owner_kind`, `owner_id`,
  `agent_id`, `agent_version`, `ran_at`, `status` (`queued` | `running` | `done` | `failed` |
  `cancelled`),
  `error`, `recall`, `precision`, `citation_accuracy`, `cases_total`, `cases_passed`,
  `duration_ms`, `cost_usd`.
- **AC-77** — The eval-case DTO the routes return shall carry `expectation_kind`, `expected_file`,
  `expected_start_line`, `expected_end_line`, `source_finding_id` and `created_at`, added
  **additively** to `EvalCase` in `contracts/knowledge.ts:131-142` with no existing field renamed or
  removed.
- **AC-78** — `@devdigest/shared` shall export `EvalCasePatch`, the request shape of
  `PATCH /eval-cases/:id`, with `name`, `notes`, `expectation_kind`, `expected_file`,
  `expected_start_line` and `expected_end_line` all optional.
- **AC-79** — `@devdigest/shared` shall export `EvalBatchDetail` as
  `{ batch: EvalBatchRecord, runs: EvalRunRecord[] }`, reusing the existing `EvalRunRecord`
  (`contracts/eval-ci.ts:33-45`) rather than defining a second per-run shape.
- **AC-8** — `client/src/vendor/shared/contracts/` shall mirror the changes this spec makes to both
  `eval-ci.ts` and `knowledge.ts`, with identical field names and types and no unrelated change —
  the two copies have already drifted (the client copy has no `AgentManifest` block and a narrower
  `provider` enum), so what is mirrored is the change, not the file.

**Scoring (`reviewer-core`, pure)**

- **AC-9** — `reviewer-core/src/index.ts` shall export `scoreEvalCase`.
- **AC-10** — `reviewer-core/src/eval/score.ts` shall import no I/O module — no LLM provider, no
  database client, no `node:fs` — so `scoreEvalCase` computes its result from its arguments alone.
- **AC-11** — `scoreEvalCase` shall treat a produced finding as *matching* an expectation when
  `finding.file` equals the expectation's file AND the inclusive ranges
  `[start_line, end_line]` intersect after `min`/`max` normalisation, computed by the single shared
  `rangesIntersect` exported from `reviewer-core/src/grounding.ts`, to which the existing private
  set-vs-range check (`grounding.ts:41-51`) delegates — so there is one definition of "intersects"
  in the package and no second implementation.
- **AC-12** — `scoreEvalCase` shall return `recall` = (number of `must_find` expectations matched by
  at least one produced finding) / (number of `must_find` expectations).
- **AC-13** — `scoreEvalCase` shall return `precision` = (number of **correct** produced findings) /
  (number of produced findings), WHERE a produced finding is correct for a `must_find` case when it
  matches at least one expectation, and correct for a `must_not_flag` case when it matches **none** —
  a finding on the forbidden range being the false positive that case exists to catch, never a hit.
  **This governs the PER-CASE ratio only** — the one persisted on each `eval_runs` row and shown in
  the case list. The batch-level `precision` is a different quantity with a different denominator;
  see AC-18. The two are deliberately not the same number, because a per-case diagnostic wants
  "what share of what this case produced was noise" while a batch metric must not let the model
  choose its own weight.
- **AC-14** — `scoreEvalCase` shall return `citation_accuracy` = `kept / (kept + dropped)`, taken
  from the `ReviewOutcome`'s grounded findings and `ReviewOutcome.dropped`
  (`reviewer-core/src/review/run.ts:161`).
- **AC-15** — WHERE a case's `expectation_kind` is `must_find`, `scoreEvalCase` shall return
  `pass: true` if and only if every one of that case's expectations is matched.
- **AC-16** — WHERE a case's `expectation_kind` is `must_not_flag`, `scoreEvalCase` shall return
  `pass: true` if and only if no produced finding matches the case's expected file and range.
- **AC-17** — IF a ratio's denominator is zero (a `must_not_flag` case has no `must_find`
  expectations; a run that produced no findings has no findings to judge; a run with no findings has
  no grounding decisions), THEN `scoreEvalCase` shall return `1` for that ratio and shall never
  return `NaN`, `null` or `undefined` for `recall`, `precision` or `citation_accuracy`.

**Batch rollup**

- **AC-18** — The eval run executor shall set the batch's three metrics as follows, with each case
  kind driving exactly one of the first two:
  - `recall` = total matched `must_find` expectations / total `must_find` expectations, **pooled**
    across the cases that were scored.
  - `precision` = total `must_not_flag` expectations **avoided** / total `must_not_flag`
    expectations, pooled the same way. An expectation is avoided when no produced finding matches
    it. A `must_find` case contributes nothing to `precision`; a `must_not_flag` case contributes
    nothing to `recall`.
  - `citation_accuracy` = the **unweighted mean** of each scored case's own
    `kept / (kept + dropped)` — one vote per case row, **not pooled**.
  - WHERE a pooled denominator sums to zero — every contributing case was of the opposite kind —
    the metric shall be `null`, never `1`. The `0/0 → 1` convention is AC-17's **per-case** rule and
    does not apply at batch scope: a batch that measured nothing must not read as perfect.

  **No number the model chooses may influence a batch metric's weighting.** That is the requirement
  the three bullets implement. `recall` and `precision` take their counts from stored case rows.
  `citation_accuracy`'s per-case denominator is necessarily a count of produced findings, so it is
  averaged rather than pooled — averaging caps each case's influence at one vote, while pooling
  would make a case's weight equal its model-emitted finding count. The per-case ratios on each
  `eval_runs` row are unchanged and remain finding-denominated (AC-13).

  **Amended three times on 2026-10-07/08, after this spec reached `done`.** Each amendment was
  correct about the defect it found and wrong about something else; the history is kept because the
  wrong turns are the instructive part.

  1. The original wording said "unweighted arithmetic mean" for all three, and that is what shipped.
     The first live run showed it could not detect the regression this feature exists to detect:
     degrading an agent's prompt took findings per call from 9.0 to 16.7 and collapsed per-case
     `must_find` precision (0.071 → 0.050, 0.111 → 0.062), while the batch mean moved
     **0.344 → 0.343** — a `must_not_flag` case's precision *rises* as the agent gets noisier, and
     cancelled the `must_find` cases falling.
  2. The first amendment replaced the mean with pooling over finding-denominated counts. A
     `/pr-self-review` security pass showed that traded one pathology for another: with no `.max()`
     between the model and `findings.length`, a case's *weight* became proportional to a number the
     model chooses — one `must_not_flag` case emitting 1000 off-target findings scores 1000/1001 and
     drags the batch to ~1.0 regardless of every other case. Capping was rejected as arbitrary;
     denominating by expectation count removes the lever.
  3. The second amendment did that but kept `citation_accuracy` pooled, on the argument that its
     model-derived denominator is inherent to what it measures. That argument addresses the
     *per-case* denominator and not *cross-case weighting*, which was the actual exposure — so the
     lever simply moved to the one metric still pooled. The same review also found that
     `poolRatio`'s `0/0 → 1` made an **all-`must_find` batch report `precision: 1.00`** — the
     default shape, since `must_find` cases come from accepted findings and nothing requires a
     dismissed one. A reviewer reproduced it: three such cases that dropped 5 of 6 citations
     returned `precision: 1`, rendered "100%". An agent emitting nothing but false positives would
     have scored perfectly.

  One more thing that review established, worth stating because it narrows what pooling is for:
  **a case row carries exactly one expectation**, so `recall`'s and `precision`'s denominators are
  always 0 or 1 and denominator-weighting is unreachable for them. Pooling those two buys only the
  exclusion of opposite-kind cases' vacuous `0/0`, which is what the mean was wrongly averaging in.
  All three amendments are recorded in `server/INSIGHTS.md` with the batch ids and measured figures.

- **AC-19** — The eval run executor shall set `cases_total` to the number of cases the batch was
  queued with and `cases_passed` to the number of its `eval_runs` rows with `pass = true`.
- **AC-20** — The eval run executor shall set the batch's `cost_usd` to the decimal sum of its
  cases' `cost_usd` values, computed without binary-float accumulation, and `duration_ms` to the
  wall-clock milliseconds from the first case starting to the batch reaching a terminal status.
- **AC-65** — IF any case of a batch has a null `cost_usd`, THEN the eval run executor shall set the
  batch's `cost_usd` to `null` rather than to a partial sum — one unpriced model makes a whole run's
  cost unknown, not smaller (`reviewer-core/INSIGHTS.md:9-15`).

**Case creation from a finding**

- **AC-21** — WHEN `POST /eval-cases` receives a valid `EvalCaseFromFindingInput`, the API shall
  respond `201` with the created case and shall insert exactly one `eval_cases` row.
- **AC-22** — WHEN a case is created from a finding, `EvalService` shall set `owner_kind='agent'`,
  `owner_id` to the agent of the finding's review, and `expected_file`, `expected_start_line`,
  `expected_end_line` to that finding's `file`, `start_line`, `end_line`.
- **AC-23** — WHEN a case is created from a finding, `EvalService` shall derive `expectation_kind`
  as `must_find` if the finding's `accepted_at` is non-null and `must_not_flag` if its
  `dismissed_at` is non-null.
- **AC-24** — WHEN a case is created from a finding, `EvalService` shall store the finding's pull
  request's unified diff in `input_diff` as a snapshot, so that a later change to that pull request
  does not alter the case.
- **AC-66** — WHEN a case is created from a finding, `EvalService` shall set `source_finding_id` to
  that finding's id.
- **AC-67** — IF an eval case with the same `owner_id` and `source_finding_id` already exists, THEN
  `POST /eval-cases` shall respond `409` with code `conflict` and insert no second row.
- **AC-25** — IF the referenced finding has neither `accepted_at` nor `dismissed_at`, THEN
  `POST /eval-cases` shall respond `422` with code `validation_error` and insert no row.
- **AC-26** — IF the finding's pull-request diff cannot be loaded, THEN `POST /eval-cases` shall
  respond `422` with code `validation_error` and a message naming the reason, and insert no row.

**Case read / edit / delete**

- **AC-27** — `GET /agents/:id/eval-cases` shall return only cases whose `workspace_id` is the
  request's workspace and whose `owner_id` is that agent, ordered by `created_at` descending then
  `id` ascending.
- **AC-28** — WHEN `PATCH /eval-cases/:id` receives `name`, `notes`, `expectation_kind`,
  `expected_file`, `expected_start_line` or `expected_end_line`, the API shall persist the supplied
  fields, leave the omitted ones unchanged, and respond `200` with the updated case.
- **AC-29** — WHEN `DELETE /eval-cases/:id` succeeds, the API shall respond `200` and the case's
  `eval_runs` rows shall no longer exist.
- **AC-30** — IF the `:id` or `:batchId` of any evals route names a row that does not exist or
  belongs to another workspace, THEN the API shall respond `404` with code `not_found`.

**Run route**

- **AC-31** — WHEN `POST /agents/:id/eval-runs` is accepted, the API shall respond `202` with a body
  carrying `batch_id`.
- **AC-32** — WHEN `POST /agents/:id/eval-runs` responds `202`, exactly one `eval_run_batches` row
  shall exist for the returned `batch_id`, owned by that agent and carrying `cases_total` equal to
  the agent's case count; and WHEN that batch reaches a terminal status, exactly one `eval_runs` row
  shall exist per case. The batch's status **at the instant of the 202 is deliberately unspecified**:
  the route is `202` precisely because the sweep is not awaited, so `queued` is already in the past
  by the time any caller can observe it. An earlier wording required `status='queued'` with zero
  child rows; it passed by luck and failed on the first real integration run.
- **AC-33** — IF the agent has zero eval cases, THEN `POST /agents/:id/eval-runs` shall respond
  `422` with code `validation_error` and create no batch.
- **AC-34** — WHILE an `eval_run_batches` row for that agent has `status` `queued` or `running`,
  `POST /agents/:id/eval-runs` shall respond `409` with code `conflict` and create no second batch.
- **AC-68** — `GET /agents/:id/eval-runs` shall return that agent's batches in the request's
  workspace ordered by `ran_at` descending, so the first element is the latest batch.
- **AC-69** — WHEN `POST /eval-runs/:batchId/cancel` names a batch with `status` `queued` or
  `running`, the API shall respond `200` and trigger the `AbortController` registered for that batch
  id on `container.runBus`.
- **AC-70** — IF `POST /eval-runs/:batchId/cancel` names a batch already in a terminal status, THEN
  the API shall respond `409` with code `conflict` and change no row.
- **AC-71** — WHILE a cancellation has been signalled for a batch, the eval run executor shall start
  no further case, shall set the batch's `status` to `cancelled`, and shall leave the `eval_runs`
  rows already written intact.
- **AC-72** — WHEN the evals module's reap method runs, it shall set every `eval_run_batches` row
  still in `queued` or `running` to `status='failed'` with an `error` naming the interruption, so a
  batch orphaned by a restart cannot block AC-34 forever.
- **AC-75** — `buildApp` shall call that reap method inside its existing non-test boot block
  (`server/src/app.ts:101-112`), alongside `reapOrphanedRuns()`, `reapOrphanedJobs()` and
  `OnboardingRepository.reapRunning()`.
- **AC-35** — `GET /eval-runs/:batchId` shall return the batch record together with one entry per
  `eval_runs` row of that batch, each carrying `case_id`, `case_name`, `pass`, `recall`,
  `precision`, `citation_accuracy`, `duration_ms` and `cost_usd`.

**Executor**

- **AC-36** — WHILE a batch executes, the eval run executor shall publish its `RunEvent`s on
  `container.runBus` keyed by the batch id through `RunLogger`, so that `GET /runs/:id/events`
  called with the batch id streams them without a new route.
- **AC-37** — The eval run executor shall obtain the case's findings by calling `reviewPullRequest`
  (`reviewer-core/src/review/run.ts:188`) directly, and
  `server/src/modules/evals/run-executor.ts` shall import neither
  `modules/reviews/run-executor.ts` nor `modules/reviews/diff-loader.ts` — the ban governs the
  executor, whose rationale is that a replayed case must never re-enter the PR-coupled review path.
  `server/src/modules/evals/service.ts` **may** import `loadDiff` from
  `modules/reviews/diff-loader.ts`, and only for snapshotting a case's diff at creation (AC-24,
  AC-26).
- **AC-38** — WHEN a batch is queued, `EvalService` shall copy the agent row's `id` and `version`
  into the batch's `agent_id` and `agent_version`.
- **AC-39** — WHEN a batch starts, the eval run executor shall resolve its provider once via
  `container.llm(agent.provider)` and pass that provider to every case in the batch.
- **AC-40** — IF `container.llm` throws (a missing provider key raises `ConfigError` —
  `server/src/platform/container.ts:209-212`), THEN the eval run executor shall set the batch to
  `status='failed'` with the error message in `error`, shall write no `eval_runs` row, and shall
  make no model call.
- **AC-41** — WHEN a case finishes, the eval run executor shall write exactly one `eval_runs` row
  carrying that case's `batch_id`, `pass`, `recall`, `precision`, `citation_accuracy`,
  `duration_ms`, `cost_usd` and an `actual_output` holding the grounded findings.
- **AC-42** — IF a case's stored `input_diff` parses to zero files, THEN the eval run executor shall
  write that case's `eval_runs` row with `pass=false`, null metrics and a reason in
  `actual_output`, and shall continue executing the remaining cases of the batch.
- **AC-43** — WHEN a batch starts, the eval run executor shall load the agent's enabled linked
  skills via `container.skillsRepo.enabledForAgent` and the shared pure
  `toLoadedSkills(rows, countTokens)` helper, producing the same `LoadedSkill[]` the review executor
  passes (`server/src/modules/reviews/run-executor.ts:245,476-482`), and pass them to
  `reviewPullRequest`.
- **AC-44** — WHEN a batch reaches a terminal state, the eval run executor shall have moved its
  `status` through `queued` → `running` → one of `done`, `failed` or `cancelled`, and shall write
  that terminal row exactly once. **Enforced at the repository, not only by control flow:** both
  terminal writes are scoped to a live row (`where status in ('queued','running')`), so a second
  terminal write is a no-op. The executor's own catch-all was the counterexample — `runLog.result`
  runs inside the same `try` *after* `completeTerminal` has written `done`, so a throw from that
  emit reached the catch-all and rewrote the row to `failed`, losing the rollup. Control flow alone
  could not make this criterion true.
- **AC-45** — WHILE a batch is running, the eval run executor shall have at most one case in flight,
  so the batch makes at most one concurrent model call.
- **AC-46** — The eval run executor shall score a case against the grounded findings of the
  `ReviewOutcome` (`review.findings`), never against raw model output.
- **AC-47** — The eval run executor shall put the case's `input_diff` into a prompt only via
  `reviewPullRequest`'s own assembler, so the diff is wrapped by `wrapUntrusted()`; the
  `server/src/modules/evals/` directory shall contain no prompt assembly of its own.

**Client — "Turn into eval case"**

- **AC-48** — `FindingCard` shall render a third control labelled from the `evals` message namespace
  inside its existing `headerActions` div
  (`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:95-116`).
- **AC-49** — WHEN that control is activated, the client shall issue `POST /eval-cases`, and
  `FindingActionKind` (`server/src/vendor/shared/contracts/findings.ts:82`) shall gain no new
  member.
- **AC-50** — WHEN the `POST /eval-cases` request succeeds, `FindingCard` shall render a
  confirmation from the `evals` message namespace and disable that control for that finding for the
  remainder of the page session.
- **AC-51** — IF the `POST /eval-cases` request fails, THEN `FindingCard` shall render the API error
  envelope's `error.message` inline and leave the control enabled.
- **AC-52** — WHILE a finding has neither `accepted_at` nor `dismissed_at`, `FindingCard` shall
  render that control disabled.

**Client — Evals tab**

- **AC-53** — `AgentEditor`'s `TABS` (`client/src/app/agents/[id]/_components/AgentEditor/constants.ts:11-14`)
  shall include an entry with `key: "evals"` and `labelKey: "editor.tabs.evals"`, resolving against
  the pre-existing key in `client/messages/en/agents.json` with no second key added for that label.
  *(This absorbs a retired criterion that asserted the same `TABS` entry from the label's side; that
  id is dead and is never reused.)*
- **AC-55** — WHEN the Evals tab renders with a completed batch available, it shall show five tiles:
  recall, precision, citation accuracy, traces passed out of total, and that batch's `cost_usd`.
- **AC-73** — The Evals tab's cost tile shall render the latest **completed** batch's `cost_usd`,
  and shall render the `evals` namespace's placeholder string when that value is `null` (which it is
  whenever any case ran on a model missing from the price table, AC-65).
- **AC-74** — The Evals tab shall take the agent's latest batch from the first element of
  `GET /agents/:id/eval-runs`, and shall not read a latest-batch field from the case-list response.
- **AC-56** — IF the agent has no completed batch, THEN the Evals tab shall render each of the five
  tiles' values as a placeholder string from the `evals` namespace and shall render neither `NaN`
  nor `null`.
- **AC-57** — IF the agent has zero eval cases, THEN the Evals tab shall render an empty-state
  message from the `evals` namespace and render the "Run all evals" control disabled.
- **AC-58** — The Evals tab shall render one row per eval case carrying the case name, its
  expectation kind, its `expected_file` with the expected line range, and its pass state from the
  agent's latest batch.
- **AC-59** — WHILE the agent's latest batch has `status` `queued` or `running`, the Evals tab shall
  render a progress indicator showing completed cases out of `cases_total`, updated from the
  `GET /runs/:batchId/events` stream.
- **AC-60** — WHEN the user activates "Run all evals", the Evals tab shall first render a
  confirmation naming the number of cases and stating that each case is a real model call, and
  shall issue `POST /agents/:id/eval-runs` only after that confirmation is accepted.
- **AC-61** — WHILE the agent's latest batch has `status` `queued` or `running`, the Evals tab shall
  render the "Run all evals" control disabled.
- **AC-62** — Every user-facing string the Evals tab and the `FindingCard` eval control render shall
  resolve through `next-intl` from `client/messages/en/evals.json` or the existing `agents.json`
  key, with no literal copy in TSX.

**Enforcement split.** Seventy-six of the 77 criteria have a test behind them. The schema, route,
executor and client criteria are checked by schema introspection, an import-graph assertion, route
tests against a fake `LLMProvider`, and component tests; the scoring and rollup
criteria (AC-12 through AC-20 and AC-65) are pure-function assertions needing neither Postgres nor a
model. **The exception is AC-75**, the boot wiring: it lives inside `buildApp`'s
`if (config.nodeEnv !== 'test')` block (`server/src/app.ts:101`), so by construction no automated
test can observe it — it is confirmed by reading the file and by the manual walk. Nothing here is
prompt behaviour: the one model-dependent part of the feature — what the agent actually finds — is
the *input* to the scorer, never an acceptance criterion.

## Edge cases

| Case | Handling |
|---|---|
| **Agent with zero cases** | `POST /agents/:id/eval-runs` → `422`, no batch (AC-33); the tab shows an empty state with the run control disabled (AC-57). |
| **Stored diff no longer parses** | Parsing to zero files is treated as a case failure, not a batch failure: `pass=false`, null metrics, reason in `actual_output`, batch continues (AC-42). The case remains in the list so the user can see which one rotted. |
| **Provider key missing** | `container.llm` raises `ConfigError` (`server/src/platform/container.ts:209-212`; `server/INSIGHTS.md` 2026-10-06 records this biting PR Brief on a box with only an OpenRouter key). The batch fails whole with the message, before any spend (AC-40). |
| **Run cancelled mid-batch** | `POST /eval-runs/:batchId/cancel` aborts through `runBus.registerAbort` (AC-69); the executor finishes nothing further, marks the batch `cancelled` and keeps the rows already scored (AC-71). Cancelling a terminal batch is a `409` (AC-70). A cancelled batch is **not** a result: its partial metrics stay on the row but AC-73's tile reads the latest *completed* batch, so a cancelled sweep never masquerades as a measurement. Note the limit inherited from the review path — abort stops the loop between cases and only aborts an in-flight HTTP call on a provider that honours `AbortSignal` (`reviewer-core/src/review/run.ts:144-152`). |
| **Batch orphaned by a restart** | Marked `failed` by a reap method (AC-72) that `buildApp` calls on boot (AC-75), which also releases AC-34's guard. It is the fourth reap in the same non-test block as `reapOrphanedRuns()`, `reapOrphanedJobs()` and `OnboardingRepository.reapRunning()` (`server/src/app.ts:101-112`), and it inherits that block's recorded assumption of **one API instance per database** (`server/src/app.ts:89-90`): with replicas it would reap a sibling's live batch and would need per-instance scoping or heartbeats. It also inherits the block's test skip — nothing reaps under `NODE_ENV=test`, which is why AC-72 is tested by calling the method, not by booting. |
| **Two concurrent runs on one agent** | Second request → `409` (AC-34). The guard is a read-then-write, so under true simultaneity the database is the decider: the partial unique index on `eval_run_batches (owner_id) where status in ('queued','running')` (AC-76) rejects the second insert, and the route maps that rejection to the same `409 conflict`. Neither request can produce a second live batch, so the failure mode is a refused request, never a double sweep. |
| **The same finding clicked twice** | The second `POST /eval-cases` is rejected `409` by the unique partial index (AC-67), so a reload no longer defeats the client's session-scoped disable (AC-50). Hand-written cases keep `source_finding_id` null and are unaffected (AC-64). |
| **A case ran on a model with no price** | The case's `cost_usd` is `null`, so the **batch's** `cost_usd` is `null` too — not a partial sum (AC-65, `reviewer-core/INSIGHTS.md:9-15`). The tab's cost tile then renders the placeholder (AC-73). Metrics are unaffected; only the money is unknown. |
| **Finding whose review has no retrievable diff** | `POST /eval-cases` → `422` naming the reason, no row (AC-26). The reviews diff loader already falls back to a synthetic diff assembled from `pr_files` (`server/src/modules/reviews/diff-loader.ts:9`), so this fires only when both paths fail. |
| **Cost rollup when a case fails** | A failed case is counted in `cases_total` and contributes nothing to any batch metric — neither to the pooled counts behind `recall` and `precision` nor to the `citation_accuracy` mean, which averages only scored cases (AC-18, AC-19). Its `cost_usd` joins the sum when it is a number — a case that failed before any model call spent `0`, which is a fact, not an absence — and makes the batch's rollup `null` when it is itself `null` (AC-20, AC-65). |
| **Zero findings produced on a `must_find` case** | `recall = 0`, `precision = 1` by AC-17 (no findings to be wrong about), `pass = false` by AC-15. The pair is intentional: precision alone cannot detect a silent agent, which is why both tiles exist. |
| **All ratios on a perfect `must_not_flag` case** | `1 / 1 / 1` and `pass = true` (AC-16, AC-17). |
| **Finding accepted *and* dismissed** | Not reachable through the findings API today, but AC-23 reads `accepted_at` first, so the case becomes `must_find`. |
| **Deleted parent, surviving child** | Deleting a case cascades its runs (AC-29); deleting an agent leaves cases whose `owner_id` points nowhere — `eval_cases.owner_id` is a bare `uuid` with no FK (`server/src/db/schema/eval.ts:30`) because it is polymorphic. `GET /agents/:id/eval-cases` 404s on the missing agent, so the rows become unreachable rather than corrupt. |
| **Workspace isolation** | Every route scopes by the request's workspace and 404s otherwise (AC-30). |
| **Long / RTL / emoji case names** | Case names come from a finding title or the user; the tab's row must truncate rather than overflow (`## Non-functional`). |
| **Slow backend during a sweep** | The SSE stream carries the existing bounded 512-event queue (`server/src/modules/reviews/routes.ts:27`); the tab's authority for final numbers is `GET /eval-runs/:batchId`, not the stream, so a dropped frame costs progress ticks and never a metric. |

**Checked and ruled out** (so a reader can disagree with the dismissal): pagination and sort
boundaries — a case list is per agent and expected to be tens of rows, so AC-27 specifies a total
order and no cursor; permission denied — the API has one workspace and no per-user roles today;
clock skew / time zones — `ran_at` is `timestamptz` and the tab shows relative progress, not a
formatted date; negative or non-dividing numbers — all four metrics are ratios in `[0, 1]` by
construction given AC-17; stale read on the batch — the tab refetches
`GET /eval-runs/:batchId` on stream completion.

## Non-functional

- **`0022` adds five `NOT NULL` columns with no `DEFAULT`, and that is a decision, not an oversight.**
  `eval_cases.expectation_kind` / `expected_file` / `expected_start_line` / `expected_end_line` and
  `eval_runs.batch_id` would abort `pnpm db:migrate` on any database holding even one row in those
  tables. None can: they were roadmap scaffolding that nothing in `src/` or `db/seed.ts` has ever
  written (verified 2026-10-07 — both tables held 0 rows, and `grep` finds no writer), so a row can
  only exist if someone hand-inserted one. A hardening migration (nullable → backfill → `SET NOT
  NULL`) was considered and declined: it would add permanent history to defend a state that cannot
  occur. If a future table in this family ever ships with rows, that calculus changes.
- **Money is never a binary float.** `eval_runs.cost_usd` and `eval_run_batches.cost_usd` are
  `numeric(12,6)` and the rollup is a decimal sum (AC-4, AC-20), matching the correction already
  recorded at `server/src/db/schema/eval.ts:15-17,51-54`. The four ratio columns stay
  `doublePrecision` — statistical ratios, where binary float is fine.
- **The migration is additive, and that is a review check, not a criterion.** The diff adds exactly
  one file under `server/src/db/migrations/` plus its `meta/` snapshot and modifies no pre-existing
  `.sql` file or snapshot. It is stated here rather than as an `AC-N` because it constrains the
  *diff*, not the product, and no running system can observe it; the standing guard is
  `migrations-additive.test.ts` (journal-hash proxy) plus a reviewer reading
  `git diff --name-status server/src/db/migrations/`.
- **`numeric` always arrives as a string.** Drizzle 0.38's `numeric()` has no `mode: 'number'`
  (`server/INSIGHTS.md:144-150`), so both eval repositories convert at the row↔DTO boundary —
  `Number()` on read, `String()` on write — exactly as `run.repo.ts:67,186` does. Services and the
  scorer therefore see numbers only; no `cost_usd` string is allowed past the repository, and no
  float accumulator is allowed inside it.
- **An unknown cost is `null`, never `0` and never a partial sum.** One unpriced model makes the
  whole batch's cost unknown (AC-65); every consumer of `cost_usd` — the rollup, the contract, the
  tile — is null-tolerant by construction (AC-73, AC-56).
- **Bounded spend.** A batch makes exactly `cases_total` real model calls, sequentially (AC-45), and
  the user is told the number before the first one (AC-60) and what the previous batch cost (AC-73).
  0019 ships **no hard cap** on `cases_total` — a decided position, not an omission: the guards are
  informational, plus the ability to stop a running sweep (AC-69).
- **Reusing `GET /runs/:id/events` is safe, and that is not an accident.** The route subscribes by
  id with no database lookup (`server/src/modules/reviews/routes.ts:65-96`), caps one slow consumer
  at 512 buffered events (`routes.ts:27,85-93`), and — the part that matters — wakes its generator
  from `reply.raw.on('close', …)` (`routes.ts:107-112`), because `fastify-sse-v2` never calls
  `.return()` on the iterator it drains and a disconnected client would otherwise leak the
  subscription forever (`server/INSIGHTS.md:182-188`). A batch inherits all three properties; adding
  a second SSE route would mean re-deriving them.
- **What this harness cannot do.** It measures only what a stored diff plus a file/line expectation
  can express: it cannot tell a correct finding with a weak rationale from a strong one, cannot
  detect a finding that is right about a line for the wrong reason, and — because the agent is
  re-run against a diff it has already been trained-of-thought on — cannot distinguish genuine
  improvement from variance across two runs of the same configuration. Two runs of an unchanged
  agent will differ; nothing in 0019 reports a confidence interval.
- **Accessibility.** Every new control carries an accessible name from `next-intl` (AC-62), is
  reachable by keyboard in the existing tab order, and per-case pass state is conveyed by text as
  well as colour (WCAG 2.2 AA, 1.4.1 Use of Colour).
- **No N+1.** `GET /eval-runs/:batchId` reads the batch and its runs in at most two queries, and the
  Evals tab's initial paint issues at most two API requests (cases, latest batch).
- **Layout.** A case row truncates its name and its `file:line` with an ellipsis at the container
  width rather than overflowing, and the metric tiles wrap at phone width.

## Inputs (provenance)

| Input | Source | Provenance | Notes |
|---|---|---|---|
| Finding `file`, `start_line`, `end_line` | `findings` rows via the reviews module | `[reused: spec 0002]` | Become `expected_file` / `expected_start_line` / `expected_end_line`. |
| `accepted_at` / `dismissed_at` | `findings` rows | `[reused: spec 0002]` | The only source of `expectation_kind` (AC-23). |
| Pull-request unified diff | `loadDiff` (`server/src/modules/reviews/diff-loader.ts:12-19`), itself falling back to `pr_files` | `[reused: L01]` | Snapshotted into `eval_cases.input_diff` at creation; never re-fetched at run time. |
| Agent `provider`, `model`, `system_prompt`, `strategy`, `version` | `agents` rows (`server/src/db/schema/agents.ts:8-33`) | `[reused: spec 0006]` | `version` is copied onto the batch (AC-38) so 0020 can diff configurations. |
| Enabled linked skills | `loadSkills` (`server/src/modules/reviews/run-executor.ts:245`) | `[reused: spec 0006]` | Same path as a review run, so a skill change is measurable. |
| Produced findings | `reviewPullRequest` → provider | `[llm]` | Not reproducible; the scorer's input, never a source of truth. |
| `kept` / `dropped` | `groundFindings()` (`reviewer-core/src/grounding.ts:57-89`), surfaced as `ReviewOutcome.dropped` | `[deterministic: citation grounding against the case's own diff]` | The numerator and denominator of `citation_accuracy`. |
| `recall`, `precision`, `citation_accuracy`, `pass` | `scoreEvalCase` | `[deterministic: pure function in reviewer-core]` | No model anywhere on this path. |
| Per-case `cost_usd` | `ReviewOutcome.costUsd` | `[reused: spec 0001]` | Provider usage × price table; `null` when the model is absent from the price table or the provider reports no usage — and one null makes the batch's rollup null (AC-65). |
| `expectation_kind`, `expected_*`, `source_finding_id`, `created_at`, `eval_run_batches` rows, `batch_id` | this spec | `[new]` | |
| Case `name`, `notes` | the user, via creation and `PATCH` | `[new]` | Operator-supplied text; rendered, never prompted. |

## Untrusted inputs

**`eval_cases.input_diff` is untrusted, every time, and it reaches a model prompt.**

- For a finding-derived case (the only creation path in 0019) the diff is a **stranger's code and
  commit text**, copied verbatim out of a real pull request. Snapshotting it into our own table
  changes nothing about its provenance; a diff that carried a prompt-injection attempt when the
  review ran still carries it when the case is replayed, and now it is replayed deliberately, on a
  schedule the operator chose.
- For a hand-written case (0020's Case Editor, out of scope here but the same column) the text is
  operator-supplied and still flows into the identical prompt, so it gets the identical treatment.
  There is no "trusted diff" branch to add later.

The obligations are `reviewer-core/AGENTS.md`'s, unchanged, and they are satisfied **by routing
through the same engine function rather than by new code**:

- All untrusted content is wrapped with `wrapUntrusted()`. The eval path must therefore have no
  prompt assembler of its own — `reviewPullRequest`'s assembler is the only one that may see
  `input_diff` (AC-47). Note the limit of that wrapper: it escapes the closing delimiter only, and
  prompt authority keyed on a block *name* is forgeable (`server/INSIGHTS.md`, 2026-10-06;
  `reviewer-core/src/prompt.ts:30-34`).
- Grounding stays mandatory: the executor scores the **grounded** findings and nothing else
  (AC-46), so a finding the model invented about a file not in the case's diff is dropped before it
  can affect recall or precision — and `citation_accuracy` is precisely the record of how often
  that happened (AC-14).
- `expected_output`, `expected_file` and the expected line range are **never** put into a prompt.
  They are compared in code after the run (AC-11). Showing the model what it is supposed to find
  would make every metric meaningless, so this is a correctness requirement as much as a security
  one.
- `name` and `notes` are rendered in the Evals tab as text through React's default escaping; they
  are not prompted (AC-62 routes copy, not data).

## Test plan

| Criteria | How |
|---|---|
| AC-1, AC-2, AC-3, AC-4, AC-63, AC-64, AC-76 | `server/` integration test (`evals-schema.it.test.ts`): insert a batch, a case and a run against the migrated database (`pnpm db:migrate` runs first — migrations are **not** applied on boot, `server/INSIGHTS.md:9-15`); assert the column set including `source_finding_id` and `created_at`, and that `cost_usd` round-trips `0.000001` exactly while a ratio column accepts `0.3333333333`. Case index: two rows with the same `(owner_id, source_finding_id)` → rejected; two rows with the same `owner_id` and a null `source_finding_id` → both accepted. Batch index: a second `queued` batch for the same `owner_id` → rejected, while a second batch for an owner whose only other batch is `done` → accepted, and two `done` batches for one owner → both accepted. Negative control: an `eval_runs` insert with an unknown `batch_id` is rejected. **`expectation_kind` is NOT enforced by the database** — Drizzle's `text(col, { enum })` narrows the TypeScript type only and emits a plain `text` column (no `CHECK` exists in any of the 23 migrations), so the test asserts a raw SQL insert of an unknown kind **succeeds** and round-trips verbatim, documenting that the enum lives in `EvalExpectationKind` and at the `.values()` call site and protects neither a raw write nor a future repository method that skips validation. An earlier draft of this row called for the opposite assertion; it described behaviour that does not exist. The standing additive-migration guard (`migrations-additive.test.ts`, journal-hash proxy) runs in the same lane; it belongs to the review checklist in `## Non-functional`, not to a criterion. |
| AC-6, AC-7, AC-78, AC-79 | `server/` unit test over the barrel: `EvalExpectationKind`, `EvalBatchRecord`, `EvalCaseFromFindingInput`, `EvalCasePatch` and `EvalBatchDetail` are exported; `EvalBatchRecord.parse` accepts a full row with each of the five statuses and rejects `status: 'paused'`; `EvalCasePatch.parse({})` **fails** and so does `EvalCasePatch.parse({ nmae: 'typo' })`, while a real partial patch succeeds and `EvalCasePatch.parse({ expectation_kind: 'maybe' })` fails. An earlier wording had `{}` succeeding "because every field is optional"; that shipped a 500 — the empty object reached Drizzle's `.set({})`, which throws a bare `Error`, not an `AppError`. The schema now carries `.strict()` (so an unknown key is rejected rather than silently stripped into an empty patch) and a `.refine` requiring at least one field, following `ConventionPatch` (`contracts/knowledge.ts:338-347`); `EvalBatchDetail.parse` accepts `{ batch, runs: [] }` and the `runs` element is the existing `EvalRunRecord` (asserted by parsing one fixture against both). Negative control: a round-trip of one pre-existing export (`EvalCaseInput`) still parses. |
| AC-77 | `server/` unit test: `EvalCase.parse` accepts a row carrying all six new fields, and still accepts one where `source_finding_id` is null; a snapshot of its key set proves every pre-existing field survived (nothing renamed or removed). |
| AC-8 | `client/` unit test importing the new schemas from both copies of `contracts/eval-ci.ts` **and** both copies of `contracts/knowledge.ts`, asserting identical `safeParse` verdicts over a shared fixture table (one valid row, three invalid). Negative control: a contract the spec does not touch parses identically too, so the test fails on an unrelated client-side edit. Prose, not an assertion: the client may import these schemas as **values** only inside client code that `next` compiles — a value import from `@devdigest/shared` passes `pnpm typecheck` and vitest and still breaks `next dev` / `next build` (`client/INSIGHTS.md:83-89`), so the tab's own imports stay `import type` unless the build is re-checked. |
| AC-9, AC-10 | `reviewer-core/` unit test: `scoreEvalCase` is importable from `src/index.ts`; plus a static assertion over `reviewer-core/src/eval/score.ts`'s import list — it contains no LLM provider module, no database client and no `node:` I/O builtin. Negative control: the same assertion run against a file that *does* import `node:fs` fails, so the check is not vacuous. |
| AC-11 | `reviewer-core/` unit test table: same file + overlapping range → match; same file + adjacent-but-disjoint range → no match; different file + identical range → no match; reversed `start`/`end` → match (normalisation); `end_line: 2_000_000_000` returns without iterating (the matcher is an O(1) comparison, so a model-controlled `end_line` cannot drive a loop — the reason `rangesIntersect` is range-vs-range and not the private set-vs-range check). |
| AC-12, AC-13 | `reviewer-core/` unit test: a two-expectation `must_find` case with one matched → `recall 0.5`; three findings of which one matched → `precision ≈ 0.333`. Negative control: a case where everything matches scores `1` on both. **Kind inversion:** a `must_not_flag` case whose single finding lands exactly on the forbidden range scores `precision 0`, not `1` — and the same case with one finding elsewhere scores `1`, so the two directions are both pinned. Without this pair the metric reads 100% precise for a batch of uniformly-failing dismissed-derived cases. |
| AC-14 | `reviewer-core/` unit test: an outcome with 3 kept + 1 dropped → `0.75`; 4 kept + 0 dropped → `1`. |
| AC-15, AC-16 | `reviewer-core/` unit test: `must_find` with one of two matched → `pass false`, both matched → `pass true`; `must_not_flag` with a finding on the named range → `pass false`, with a finding on a different file → `pass true`, with no findings → `pass true`. |
| AC-17 | `reviewer-core/` unit test: zero `must_find` expectations → `recall 1`; zero findings → `precision 1`, `citation_accuracy 1`; every returned ratio asserted `Number.isFinite`. |
| AC-18, AC-19, AC-20, AC-65 | `server/` unit test on the rollup helper with a fake clock: three cases (metrics, metrics, failed-with-null-metrics) → the two scored cases' counts pooled, `cases_total 3`, `cases_passed` from the `pass` flags, `cost_usd` the exact decimal sum of `0.000001 + 0.000002` with no float accumulator, `duration_ms` the fake clock's delta. Then the null path: one case with `cost_usd: null` → the batch's `cost_usd` is `null`, not `0.000003`, while the three pooled metrics are unchanged. **Each metric must be mutation-checked separately** — changing one metric's aggregation must fail that metric's own test and no other. A wholesale revert is not sufficient: that gap let `recall` and `citation_accuracy` ship pooled but untested. Three assertions carry the amendments: an **all-`must_find` batch pins `precision` to `null`, never `1`** (the vacuous-denominator regression, which a reviewer reproduced live at `precision: 1` for a batch that dropped 5 of 6 citations); a `citation_accuracy` case where one case's finding count dwarfs another's pins the **mean**, and fails if pooled; and the finding-count invariance of `precision` is pinned in `reviewer-core` **through `scoreEvalCase`**, not by hand-written rollup fixtures — fixtures that never call the scorer cannot detect a reverted mapping, which is how the first version of that test came to be vacuous. Note for `recall` and `precision` the rollup fixtures pin the *exclusion of vacuous `0/0` contributors*, not denominator-weighting: a case row carries one expectation, so those denominators are always 0 or 1. Values cross the repository boundary as strings (`Number()`/`String()`, `run.repo.ts:67,186`), so the test asserts the repository hands the service numbers and writes a string. |
| AC-21, AC-22, AC-23, AC-24, AC-66 | `server/` integration test (`evals-cases.it.test.ts`) over a seeded accepted finding and a seeded dismissed finding: `201`, exactly one row each, derived owner and expectation target fields, `source_finding_id` equal to the finding id, `must_find` vs `must_not_flag`, and `input_diff` unchanged after the pull request's diff is mutated. |
| AC-25, AC-26, AC-67 | Same file, negative paths: an open finding → `422 validation_error`, row count unchanged; a finding whose pull request has neither a loadable diff nor `pr_files` → `422` with a reason; the same finding posted twice → `409 conflict` with the row count still `1`. Positive control in the same test: a *different* accepted finding on the same agent still returns `201`, so the index constrains the pair and not the owner. |
| AC-27, AC-28, AC-29, AC-30 | `server/` integration test: list ordering over three cases inserted with controlled `created_at` values, newest first, ties broken by id ascending; a `PATCH` of `name` alone leaves `expected_file` intact; a `DELETE` removes the case and its runs; a second workspace's case id → `404 not_found` on `GET`, `PATCH`, `DELETE` and `GET /eval-runs/:batchId`. |
| AC-31, AC-32, AC-33, AC-34 | `server/` integration test with a fake `LLMProvider`: `202` + `batch_id`, exactly one batch row for the returned id with the right owner and `cases_total`, then — after waiting for a terminal status — exactly one child row per case. **Do not assert the status at 202 time**, and do not assert zero child rows then: `MockLLMProvider` answers instantly and the sweep is not awaited, so both are races. A zero-case agent → `422`, a second `POST` while the batch is `running` → `409 conflict`. Positive control: once the batch reaches `done`, a second `POST` is accepted. Build order is irrelevant here: the boot reap does not run under `NODE_ENV=test` (`server/src/app.ts:101`), so a seeded `running` batch survives any number of `buildApp` calls. AC-34's guard is also exercised from below: with the service-level check stubbed out, the insert still fails on AC-76's partial unique index and the route still answers `409 conflict` — the same response from the other layer. |
| AC-68 | `server/` integration test: three batches for one agent with controlled `ran_at` → returned newest first, the first element being the latest; another agent's batch and another workspace's batch are absent. |
| AC-69, AC-70, AC-71 | `server/` integration test with a fake provider that blocks between cases: cancel a `running` three-case batch after its first case → `200`, the registered `AbortController` is aborted, the provider's call count stays at `1` (cases two and three never start), batch `status='cancelled'`, and the one `eval_runs` row already written is still there. Negative control: cancelling the same batch once terminal → `409 conflict` and the row is byte-identical. No defensive guard is needed around the bus: `registerAbort` is a `Map.set` returning an unregister closure and aborts immediately if cancellation was already requested (`server/src/platform/sse.ts:53-59`), and `cancel()` is `this.aborts.get(runId)?.abort()` (`:64-67`) — cancelling a batch with no in-flight provider call is a silent no-op, never a throw. |
| AC-72 | `server/` integration test calling the reap method **directly**, the way `ReviewService.reapOrphanedRuns()` is exercised: seed a `running`, a `queued` and a `done` batch, invoke the method, assert the first two are `failed` with a non-empty `error` and the third is untouched. A boot test is impossible by construction and must not be re-added: the reap block is wrapped in `if (config.nodeEnv !== 'test')` (`server/src/app.ts:101`), and that skip is load-bearing — `loadConfig` reads `databaseUrl` from the ambient environment with no test override, so a test boot would reap the **developer's** database (`server/src/app.ts:92-100`). Under `NODE_ENV=test`, `buildApp` reaps nothing at all. |
| AC-75 | Assertion by reading, not by running: the call sits in the non-test block of `server/src/app.ts:101-112` next to the three existing reaps. Nothing executes it under test (see AC-72), so no automated check can cover the wiring; a reviewer confirms the line exists, and the manual walk below is where a real boot exercises it. |
| AC-35 | `server/` integration test: after a two-case batch completes, the response carries the batch plus two entries with the listed fields populated. |
| AC-36 | `server/` integration test: subscribe to `GET /runs/:batchId/events` before starting a batch and assert at least one `RunEvent` per case plus the terminal completion, with no new SSE route registered (route-table snapshot assertion). The reused route already wakes its generator on `reply.raw.on('close')` and caps a slow consumer at 512 events (`reviews/routes.ts:107-112,27`), so the test also disconnects mid-batch and asserts the subscription count returns to zero rather than leaking (`server/INSIGHTS.md:182-188`). |
| AC-37, AC-47 | `server/` unit test over the import graph, targeted at **`server/src/modules/evals/run-executor.ts`**: none of its specifiers resolves to `reviews/run-executor` or `reviews/diff-loader`. Positive control in the same test: `server/src/modules/evals/service.ts` **does** import `loadDiff` from `reviews/diff-loader`, so the assertion cannot be satisfied by an evals module that reaches no diff at all. Plus: no file under `modules/evals/` calls `assemblePrompt` / `wrapUntrusted`, and a provider spy asserts the system/user messages the eval path sends contain the untrusted wrapper around the case diff. |
| AC-38, AC-39, AC-43 | `server/` integration test with a spying fake provider: the batch row's `agent_id`/`agent_version` equal the agent row's at queue time (and do not change when the agent is edited mid-batch); `container.llm` is called once for a three-case batch; the agent's one enabled linked skill appears in the prompt for every case while a disabled link does not. Plus a `server/` unit test on the lifted `toLoadedSkills(rows, countTokens)` in `modules/skills/helpers.ts`: given rows and a counting stub it returns the same `LoadedSkill[]` the review path produced, and the helper's import list stays free of `container` / repository modules — the point of lifting only the pure half. |
| AC-40 | `server/` integration test with the provider key removed: batch `status='failed'`, `error` names the provider, zero `eval_runs` rows, and the fake provider's call count is `0`. |
| AC-41, AC-44, AC-45, AC-46 | `server/` integration test over a two-case batch: exactly two `eval_runs` rows with every listed column non-null, the observed status sequence `queued`→`running`→`done` with one terminal write, the provider never holding two concurrent calls (the fake counts overlap), and a model output naming a file absent from the case diff scoring as a miss because grounding dropped it. |
| AC-42 | `server/` integration test: a three-case batch whose middle case has `input_diff = 'not a diff'` → that row `pass=false` with null metrics and a reason, the other two scored, batch `done`. |
| AC-48, AC-49, AC-50, AC-51, AC-52 | `client/` component test for `FindingCard`: the third control renders inside `headerActions`; activating it issues one `POST /eval-cases` and no finding-action request; success renders the confirmation and disables it; a `422` envelope renders `error.message` inline and leaves it enabled; an open finding renders it disabled. Plus a static assertion that `FindingActionKind`'s member list is exactly `accept`, `dismiss`, `learn`, `reply`. |
| AC-53 | `client/` unit test on `AgentEditor/constants.ts`: `TABS` contains the `evals` entry, the rendered label equals the `agents.json` value for `editor.tabs.evals`, and no new key named `*.tabs.evals` exists in `evals.json`. |
| AC-55, AC-56, AC-57, AC-58, AC-73, AC-74 | `client/` component test for the Evals tab against fixtures: a completed batch renders five tiles with the fixture's numbers, the fifth being its `cost_usd`; a batch with `cost_usd: null` renders the placeholder in that tile while the other four still show numbers; no batch at all renders the placeholder in all five and the DOM contains neither `NaN` nor `null`; zero cases renders the empty state with the run control disabled; two cases render two rows with name, kind, `file:lines` and pass state. The latest batch comes from the first element of a stubbed `GET /agents/:id/eval-runs` — the test stubs that list out of chronological order and asserts the tab shows the **first** element, and asserts no request expects a `latest_batch` field. Negative control for AC-73: a `cancelled` newest batch and an older `done` one → the tiles read the `done` one. |
| AC-59, AC-60, AC-61 | `client/` component test: a `running` batch renders `1/3` from a stubbed event stream and the run control disabled; activating the run control on an idle agent with four cases renders a confirmation naming `4` and issues no request until it is accepted. Query the confirmation **by text, not by `getByRole("heading")`** — the vendored `Modal` renders its title in a plain `div` and no heading role will ever match (`client/INSIGHTS.md:120-126`). Negative control: dismissing the confirmation issues nothing. |
| AC-62 | `client/` component test rendered with an empty message catalogue: every string the tab and the control show resolves to a missing-key marker rather than readable English — a literal in TSX would survive and fail the assertion. |
| — | Manual walk on `./scripts/dev.sh`: turn a seeded accepted finding into a case and a dismissed one into a second, run the set from the Evals tab, read the metrics; then edit the agent's system prompt to something deliberately sloppy and re-run, confirming precision visibly falls. That experiment is the feature's real deliverable. |
| — | Manual walk, second half: start a sweep and cancel it mid-batch, confirming the tab stops advancing, the batch reads `cancelled`, and the tiles still show the last **completed** batch rather than the partial one. Then the only exercise AC-75 can get: start a sweep, kill the API process mid-batch, restart it with `./scripts/dev.sh`, and confirm the orphaned batch now reads `failed` and the agent is runnable again. |

## Phases

| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-10-06 | request read, specs + INSIGHTS checked; three `researcher` passes run (repo-side eval scaffolding, course-branch comparison, engine/grounding surface) |
| Planning | 2026-10-07 | spec approved by the user. 9 decisions recorded: real LLM calls only · background + SSE over the existing `runBus` · agents + skills as owners (agents in 0019) · runner calls `reviewPullRequest` directly rather than reusing `ReviewRunExecutor` · `eval_run_batches` as a parent table · open findings refused (422) rather than defaulted to `must_find` · `source_finding_id` + `created_at` + partial unique index land in this migration · cancellation and the startup sweep in 0019 · no hard cap on `cases_total`, confirmation names N. Three rounds with `spec-creator`; round 2 introduced an AC-72 boot test that could never pass (the reap is env-gated at `server/src/app.ts:101`) and round 3 split it into AC-72 (method behaviour) + AC-75 (wiring, read-verified). Rounds 4–5 then applied the eight corrections `implementation-planner` raised (`specs/0019-evals.plan.md`): AC-37 narrowed to the executor with a positive control, a live-batch unique index added (AC-76), three contract criteria added (AC-77, AC-78, AC-79) with AC-8 reworded, AC-10 restated as a static import assertion, AC-11 pointed at the shared `rangesIntersect`, AC-5 demoted to a review-checklist line and AC-53/54 collapsed. **AC-5 and AC-54 are retired ids — never reuse them.** `scripts/check-specs.sh` green at 77 criteria. |
| Implementation | 2026-10-07 | Multi-agent, per `specs/0019-evals.plan.md`'s decomposition: wave 1 shared contracts (both `vendor/shared` copies) → waves 2a/2b in parallel (the pure scorer + schema + migration `0022_chemical_harrier`, and the client i18n/hooks/`FindingCard` control/Evals tab) → wave 3 the `evals` server module, executor, routes and boot reap. Three corrections to the plan were made during implementation and are recorded in `## Decisions`: `EvalBatchRecord` has 15 fields not 16 (the plan miscounted; AC-7 is authoritative), `EvalExpectationKind` is defined in `knowledge.ts` and re-exported from `eval-ci.ts` to avoid a module cycle, and `loadSkills` was lifted only as its pure half (`toLoadedSkills`) rather than whole, because moving the I/O into `modules/skills/helpers.ts` would have put an impure function in the one file class `pnpm arch` cannot police. |
| Validation | 2026-10-07 | `plan-verifier` green (26/26 steps, 77/77 criteria, 0 Missing/Contradicted) · `architecture-reviewer` 0 violations · `/code-review` high found **6**, two MAJOR (executor `try/finally` with no `catch` → permanent agent wedge, AC-44; `EvalsTab` never refetching on SSE completion — a requirement written as prose at `## Edge cases`, so invisible to the criteria gate), all fixed · precision inverted for `must_not_flag` (AC-13 reworded, both directions pinned) · integration lane **28 files / 151 tests green** on the third run: run 1 exposed 4 test defects (the bare-hunk diff fixture in two more files, an FK violation from assuming `eval_cases.owner_id` and `eval_run_batches.agent_id` are symmetric, and AC-32 asserting a status that cannot be observed because the sweep is not awaited), run 2 hit the documented `skills.it.test.ts` Docker-contention flake · unit: server 598, client 385, reviewer-core 84 · e2e **12/12 with 1 `⊘` mutating skip = 13 flow files, so the suite was complete** · manual walk still outstanding. |
| Completion | 2026-10-07 | `status: done` set by the user. Shipped as `a65850a`, merged with `origin/main` (`1cbe225`) and pushed to `origin/feat/pr-brief` at `e2a89be`. `/pr-self-review` PASS — 0 CRITICAL, 21 WARNING, 56 SUGGESTION, full tables in `.claude/.pr-self-review/report.md`; the warnings are recorded, not fixed. Insights wrap-up done across root, `server/`, `client/` and `e2e/`. **Two phase-5 items were NOT performed, and `done` does not assert them:** (1) the manual walk — so **AC-75 remains read-verified only** (no automated test can observe the boot reap, by construction), and the spec's own experiment at `## Test plan` (degrade the system prompt, confirm precision visibly falls) has never been run against a live provider; (2) `doc-writer` — nothing was moved into `docs/`. Also unexercised: AC-45's `maxConcurrent` assertion is unfalsifiable as written (`typescript-expert#3`), and the terminal-write guard's unit test passes when `or` replaces `and` in the predicate, so it does not pin the clause it claims to. **Amended three times on 2026-10-07/08 after `done`,** all recorded in AC-18 itself rather than by reopening the status. (1) The unweighted mean could not see a deliberate prompt degradation — findings per call 9.0 → 16.7, batch precision 0.344 → 0.343 — so AC-18 moved to pooling. (2) `/pr-self-review` found pooling over finding counts made each case's *weight* proportional to a model-chosen number, so `precision` became denominated by `must_not_flag` expectation count. (3) The next review found that had left the same lever on `citation_accuracy`, the one metric still pooled, and that `poolRatio`'s `0/0 → 1` made an all-`must_find` batch — the default shape — report **`precision: 1.00`** however many false positives the agent emitted; a reviewer reproduced it live. `citation_accuracy` returned to the per-case mean and a vacuous pooled denominator now yields `null`. AC-13 was scoped along the way to make clear it governs the per-case ratio only. **Each amendment was right about the defect it found and wrong about something else** — the metric was harder to get right than the feature around it, and three review rounds were what surfaced that. |
