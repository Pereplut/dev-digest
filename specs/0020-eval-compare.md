---
title: Eval compare — per-agent dashboard and old-prompt-vs-new
status: approved
packages: [server, client]
---

## Problem & why

Spec 0019 shipped the measurement and deliberately withheld the comparison. An agent author can run
a sweep and read one set of numbers; they cannot see whether the prompt they just edited made the
agent better. The data to answer that is already stored and already unread:

- `eval_run_batches` carries `agent_version` on every row specifically so two sweeps can be diffed
  (`server/src/db/schema/eval.ts:97`, spec 0019 AC-38), and `GET /agents/:id/eval-runs` already
  returns every batch newest-first. Nothing consumes it beyond element 0
  (`client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/helpers.ts:9-11`).
- `EvalTrendPoint` and `EvalDashboard` are defined at
  `server/src/vendor/shared/contracts/eval-ci.ts:57-89` and referenced by nothing — 0019 wrote them
  and left them inert, naming `GET /agents/:id/eval-dashboard` as 0020's work
  (`specs/0019-evals.md:84`).
- `client/src/vendor/ui/charts/LineChart.tsx` exists, `recharts` is already a client dependency, and
  0019's non-goals record that no consumer was added.
- `agent_versions` holds an immutable `config_json` snapshot per version — `provider`, `model`,
  `system_prompt`, `output_schema`, `strategy`, `ci_fail_on`, `repo_intel`, `skills`
  (`server/src/modules/agents/repository.ts:168-187`) — reachable at
  `GET /agents/:id/versions/:version` and rendered by nothing.

So the cost of the gap is the whole point of 0019 going unredeemed: the user has before-and-after
data and no before-and-after view.

Two defects block consuming that data as it stands.

1. **The dashboard contracts cannot parse real rows.** `EvalTrendPoint.recall`, `.precision`,
   `.citation_accuracy` and `EvalDashboard.current.*` / `.delta.*` are `z.number()`
   (`eval-ci.ts:57-89`), but batch metrics are nullable in the database
   (`server/src/db/schema/eval.ts:105-107`), in `EvalBatchRecord` (`eval-ci.ts:115-117`) and in
   `EvalRunRecord` (`eval-ci.ts:40-42`) — and 0019's final amendment made a vacuous pooled
   denominator return `null` on purpose, so that "measured nothing" cannot read as "perfect"
   (`specs/0019-evals.md` AC-18). A dashboard route built on today's schemas would throw on
   serialization for the most ordinary batch shape there is.
2. **The stored metrics span a formula change, and nothing records which formula produced which
   row.** Batches run before 2026-10-08 used the mean-of-per-case rollup with finding-denominated
   precision. Batches after it use **pooled, expectation-denominated `recall` and `precision`, with
   `null` on a vacuous denominator — while `citation_accuracy` stays the unweighted per-case mean**,
   deliberately rather than by omission: averaging caps each case's influence at one vote, where
   pooling its model-emitted finding count would let one noisy case set the batch's weight
   (`server/src/modules/evals/helpers.ts:111-133`, `server/INSIGHTS.md:578-583`, and 0019 AC-18's
   third amendment). Two of the three metrics changed denominator and the third changed nothing;
   what makes this one boundary is that they moved in one commit. Measured on live data: six pre-fix batches stored precision
   `0.30 / 0.38 / 0.36 / 0.32 / 0.36 / 0.35`, and the same runs recomputed under the current formula
   are `0.00 / 1.00 / 0.00 / 0.00 / 1.00 / 0.00`. The old formula flattened a metric that was in
   fact flipping between total failure and total success. A compare view that renders `0.30 → 0.91
   ▲ 61pt` across that boundary is not an imprecise statement, it is a false one — and it is false
   in exactly the direction that makes a regression look like an improvement.

## Goals / Non-goals

**Goals**

- A **per-agent eval view**: three metric tiles with deltas, an alert banner, a metric-trend line
  chart over past sweeps, and a recent-runs table whose rows are selectable.
- A **compare-two-runs modal**: four delta tiles (recall, precision, citation accuracy, cost) each
  showing `old → new` plus a signed delta, and a line-level **system-prompt diff** between the two
  batches' agent versions.
- **No comparison is ever rendered across a metrics-formula boundary, nor between two batches whose
  formula is unrecorded.** Batches are stamped with the formula that produced them, comparison
  requires a *recorded* and matching stamp on both sides (AC-24), and a withheld delta carries a
  stated reason, never
  computed.
- **Per-case detail for any past sweep**, opened from its row in the recent-runs table, so "which
  case fell?" is answerable without re-running — over the existing `GET /eval-runs/:batchId`.
- **Promote**: one control, behind a confirmation, that restores a chosen version's stored config
  onto the agent as a new version.
- The three inert contracts — `EvalTrendPoint`, `EvalDashboard`, `LineChart` — are consumed, and the
  nullability defect in the first two is fixed in both vendored copies.

**Non-goals** — named because a reader would reasonably assume them:

- **The all-agents Eval Dashboard index** (`design/eval-dashboard/01-dashboard-index.png`) and
  `GET /eval-dashboard`, the workspace-wide aggregate behind it.
- **Any change to `client/src/vendor/ui/nav.ts`.** No new top-level page ships (see `## Decisions`),
  so the single sanctioned exception to the vendored-UI rule — nav.ts may change *when a new
  top-level page ships* (root `AGENTS.md`, "Do not touch") — does not apply and is not invoked. No
  `/evals` route, no nav entry, no `g e` shortcut.
  `client/src/components/app-shell/helpers.ts:35` resolves `/eval*` to a nav item that still does
  not exist; it stays that way after 0020, exactly as it did after 0019.
- **The standalone-page chrome the mockups draw** — the `Skills Lab › Eval Dashboard › Security
  Reviewer` breadcrumb, the page title block with the model badge, the "All agents" back link, the
  agent switcher and the "Run eval" header button in `02-dashboard-agent.png` and
  `03-compare-modal.png`. **This is a deliberate deviation from the design, recorded so a reviewer
  does not read it as an omission:** the mockups draw the per-agent view as a standalone page, and
  0020 builds the same *content* inside the Evals tab, which is already reachable at
  `/agents/:id?tab=evals` and already carries the agent's identity in the editor header. The reason
  is that the page would require an edit to vendored nav code for a view that needs no new route to
  be reachable. "Run eval" in the mockup header is 0019's existing "Run all evals" control in that
  tab, unchanged.
- **The date-range picker** drawn in the per-agent mockup's header ("30 days"). The window is fixed
  at the 20 most recent comparable sweeps (AC-14) and is not user-selectable.
- **Skill-owned evals.** `owner_kind` still admits `'skill'` and every row 0020 reads or writes is
  `owner_kind='agent'`; `GET /skills/:id/eval-cases` is not added and `SkillDetail/constants.ts:8`
  (`shipped: false`) is not flipped. This matches 0019.
- **Backfilling pre-2026-10-08 batches to the current formula.** See `## Edge cases`; they are
  stamped, not recomputed.
- **Per-case drill-down inside the *compare* modal.** That modal compares two batches' rollups and
  their prompts, and shows no case list. Per-case detail is reachable instead from each
  recent-runs row (AC-73 – AC-80), one batch at a time; a *diff* of two batches' per-case results —
  "which cases flipped pass→fail" — is not built.
- **A confidence interval or any variance reporting.** 0019's `## Non-functional` records that two
  runs of an unchanged agent will differ and that nothing quantifies it; 0020 renders deltas and
  inherits that limit unchanged.
- **The manual Case Editor**, still deferred from 0019.

## Decisions

| Question | Decision | Consequence |
|---|---|---|
| How much of the design ships? | **The per-agent view plus the compare modal.** The all-agents index is deferred. | The deferred index is the only thing that would have needed a new top-level route; nothing in the shipped scope does. |
| Does promote require a confirmation step? | **Yes** — a dialog naming the version being promoted, the model it restores and the number of skills it will enable, in the pattern 0019's "Run all evals" confirmation already uses (0019 AC-60; the modal is prior art in `EvalsTab.tsx`). | One extra click on an action that is reversible but wide: a misclick otherwise rewrites the live agent's model, prompt and whole skill set at once, and the only recovery is to promote back. The dialog names the three things that actually change, so "what am I about to do" is answerable without leaving it (AC-69 – AC-72). |
| Is the alert threshold configurable? | **No — fixed at `-0.02`, a named constant** in the dashboard service (AC-16). | No settings surface and no contract field for a number nobody has yet asked to change. The accepted cost: an agent whose metrics are naturally noisy alerts on noise, with no way to quieten it short of a code change. Revisit if that happens, not before. |
| Can a non-latest sweep's per-case results be opened? | **Yes** — each recent-runs row carries a control that opens that batch's case detail (AC-73 – AC-80). This overturns the spec's first proposed default, which was "no". | "Which case fell?" is the next question after seeing precision drop, and without this a sweep that is not the latest is unreachable without re-running it — the one thing an eval harness should never make you pay for twice. **No new route**: `GET /eval-runs/:batchId` already returns the batch plus its per-case `runs` with name, pass and all three metrics (0019 AC-35, AC-79). The cost is a second dialog and a fourth request on the tab, both paid only on demand. |
| Where does the per-agent view live — a new `/evals/:agentId` page as the mockups draw it, or the existing Evals tab? | **The existing Evals tab.** The trend chart, the recent-runs table with its checkboxes and the Compare button are added to `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/`, below the metric tiles and case list that tab already renders; the compare modal opens from there. | No new page and therefore **no edit to `client/src/vendor/ui/nav.ts`** — that file is vendored code whose single sanctioned exception applies only when a new top-level page ships (root `AGENTS.md`, "Do not touch"), and no page ships, so the exception is not invoked. The view stays reachable at `/agents/:id?tab=evals`, which already works. The cost is accepted on both sides: the tab grows to one long scroll (tiles · alert · chart · recent runs · case list), and the mockups' page chrome — breadcrumb, title block, "All agents" link, agent switcher — is deliberately not built (`## Goals / Non-goals`). The tab already owns the `evals` i18n namespace and the `formatRatioTile` / `formatCostTile` helpers that AC-38 and AC-52 reuse, so no copy or formatting rule is duplicated. |
| What does "Promote v7" do? | **It restores that version's `config_json` onto the agent, as a new version.** Promoting v7 while the agent is at v8 writes v9, config-identical to v7 **except where a skill v7 named can no longer appear in a snapshot** — deleted (AC-32) or globally disabled (AC-87). Those ids come back in `skills_not_restored`, and AC-88 makes the two sets add up to v7's, so the exception is reported rather than silent. | It needs a route (`POST /agents/:id/versions/:version/promote`). `config_json` carries `provider`, `model`, `system_prompt`, `output_schema`, `strategy`, `ci_fail_on`, `repo_intel` and `skills`, so all eight are restored (AC-26, AC-28); `name`, `description` and `enabled` are **not** in the snapshot and are left alone (AC-27). History is append-only — nothing is rewritten or deleted, which is why this is "promote" and not "revert". |

## User stories

- As an **agent author**, I want to see recall, precision and citation accuracy for my agent's last
  sweep together with how each moved since the previous one, so that the effect of my last prompt
  edit is a number instead of an impression.
- As an **agent author**, I want to select two sweeps and see their metrics and their system prompts
  side by side, so that I can attribute a metric move to the specific words I changed.
- As an **agent author**, I want to restore the better-scoring version's configuration in one click,
  so that discovering the regression and undoing it are not two separate pieces of work.
- As an **agent author**, I want the product to refuse to show me a delta it cannot compute honestly,
  so that I never act on a comparison between two differently-computed numbers.
- As an **operator paying for tokens**, I want each sweep's cost beside its metrics, so that I can
  see what a two-point precision gain cost.

## Acceptance criteria (EARS)

**Metrics-formula identity**

- **AC-1** — The server schema shall give `eval_run_batches` a `metrics_version` integer column, NOT
  NULL, defaulting to the current formula constant.
- **AC-2** — The migration that adds `metrics_version` shall set every pre-existing
  `eval_run_batches` row to `1`, the value reserved to mean **formula unrecorded** — not the name
  of a formula. No code may treat `1` as denoting the pre-2026-10-08 rollup, because the rows it is
  written to were produced by at least two different formulas and nothing distinguishes them.
- **AC-3** — WHEN the eval run executor writes a batch, it shall set `metrics_version` to the single
  exported constant that names the formula implemented by the rollup helper, so that changing the
  rollup without changing the constant is a one-line review target rather than an invisible edit.

**Shared contracts** (both `server/src/vendor/shared/` — canonical — and `client/src/vendor/shared/`)

- **AC-4** — `EvalBatchRecord` shall carry `metrics_version` as an integer, added additively with no
  existing field renamed or removed.
- **AC-5** — `EvalTrendPoint.recall`, `.precision` and `.citation_accuracy` shall each be
  `z.number().nullable()`, matching `EvalBatchRecord` and the database columns.
- **AC-6** — `EvalDashboard.current.recall`, `.precision`, `.citation_accuracy` and
  `EvalDashboard.delta.recall`, `.precision`, `.citation_accuracy` shall each be
  `z.number().nullable()`.
- **AC-7** — `EvalDashboard.recent_runs` shall be `EvalBatchRecord[]` rather than `EvalRunRecord[]`,
  because the row the recent-runs table renders is a batch (it carries a version, a passed-of-total
  and a cost) and `EvalRunRecord` is per case and carries none of those.
- **AC-82** — `EvalDashboard` shall carry `trend_excluded`, an object with the non-negative integers
  `other_version` and `incomplete_metrics`, added additively.
- **AC-8** — `@devdigest/shared` shall export `EvalRunComparison` from `contracts/eval-ci.ts`
  through the barrel, carrying `old` and `new` (`EvalBatchRecord`), `old_config` and `new_config`
  (`AgentVersionConfig | null`), `comparable` (boolean), `incomparable_reason` (string | null) and
  `delta` (`recall`, `precision`, `citation_accuracy`, `cost_usd`, each `number | null`).
- **AC-9** — `@devdigest/shared` shall export `EvalPromoteResult` carrying `agent` (`Agent`),
  `version` (the newly created version number) and `skills_not_restored` (string array) — the ids
  the promoted snapshot named that the resulting version does not carry, whatever the reason
  (AC-32, AC-87, AC-88).
- **AC-10** — `client/src/vendor/shared/contracts/eval-ci.ts` shall mirror AC-4, AC-5, AC-6, AC-7,
  AC-8, AC-9 and AC-82 with identical field names and types and no unrelated change.

**Dashboard route**

- **AC-11** — `GET /agents/:id/eval-dashboard` shall respond `200` with an `EvalDashboard` whose
  `owner_kind` is `'agent'` and whose `owner_id` is that agent, computed only from batches in the
  request's workspace owned by that agent.
- **AC-12** — The dashboard service shall set `current` from the agent's latest `done` batch:
  `recall`, `precision`, `citation_accuracy` and `cost_usd` from that row and `traces_passed` /
  `traces_total` from its `cases_passed` / `cases_total`.
- **AC-13** — The dashboard service shall set each member of `delta` to the `current` batch's metric
  minus that of the most recent earlier `done` batch **comparable** with it, where comparable means
  the same `metrics_version` **and** a recorded one (`>= 2`), the identical predicate AC-24 applies
  in the compare route.
- **AC-14** — The dashboard service shall set `trend` to one `EvalTrendPoint` per `done` batch
  comparable with the `current` batch by that same predicate, ordered by `ran_at` ascending, capped
  at the 20 most recent.
- **AC-15** — The dashboard service shall set `recent_runs` to the agent's 10 most recent batches of
  any status, ordered by `ran_at` descending.
- **AC-83** — The dashboard service shall set `trend_excluded.other_version` to the number of the
  agent's `done` batches AC-14's predicate excludes — a differing `metrics_version` or an
  unrecorded one, which for a `current` batch stamped `1` is every batch the agent has — and
  `trend_excluded.incomplete_metrics` to the number of its `done` batches of `current`'s
  `metrics_version` that AC-43 drops for a `null` metric — counted over **every** batch of the
  agent, not only those the response returns.
- **AC-16** — IF any member of `delta` is at most `-0.02`, THEN the dashboard service shall set
  `alert` to the stable code of the metric with the lowest delta (`recall_drop`, `precision_drop` or
  `citation_drop`) and otherwise shall set it to `null` — a code, never rendered prose, so the
  banner's wording stays in `client/messages/en/evals.json`.
- **AC-84** — The dashboard service shall make AC-16's threshold comparison tolerant of IEEE 754
  representation error — by an epsilon (`delta <= -0.02 + 1e-9`) or by rounding the delta to four
  decimal places before comparing — so that a delta computed as `0.02 - 0.04`
  (`-0.019999999999999997`) is treated as reaching `-0.02`.
- **AC-17** — IF either operand of a delta is `null`, or no earlier `done` batch of the same
  `metrics_version` exists, THEN the dashboard service shall set that delta to `null` and shall
  never substitute `0`.
- **AC-18** — IF the agent has no `done` batch, THEN `GET /agents/:id/eval-dashboard` shall respond
  `200` with every **nullable** `current` and `delta` metric `null`, `trend` empty, `alert` `null`
  and `cases_total` the agent's eval-case count — not `404` and not an error.
- **AC-85** — IF the agent has no `done` batch, THEN the dashboard service shall set
  `current.traces_passed` and `current.traces_total` to `0`, those two fields being non-nullable
  integers that AC-6 does not widen.
- **AC-19** — IF `:id` names an agent that does not exist or belongs to another workspace, THEN
  `GET /agents/:id/eval-dashboard` shall respond `404` with code `not_found`.

**Compare route**

- **AC-20** — WHEN `GET /agents/:id/eval-runs/compare` is called with two batch ids, the API shall
  respond `200` with an `EvalRunComparison` whose `old` is the batch with the earlier `ran_at` and
  whose `new` is the other, irrespective of the order the ids were supplied in.
- **AC-21** — IF either batch id is unknown, belongs to another agent, or belongs to another
  workspace, THEN the compare route shall respond `404` with code `not_found`.
- **AC-22** — IF the two supplied batch ids are equal, THEN the compare route shall respond `422`
  with code `validation_error`.
- **AC-23** — IF either named batch has a `status` other than `done`, THEN the compare route shall
  respond `422` with code `validation_error` and a message naming the offending status.
- **AC-24** — The compare route shall set `comparable` to `true` only when both batches carry the
  **same** `metrics_version` **and** that version is `>= 2`, a value denoting a recorded formula;
  otherwise it shall set `comparable` to `false`.
- **AC-89** — IF either batch carries `metrics_version` `1`, THEN the compare route shall set
  `incomparable_reason` to the stable code `metrics_version_unrecorded`, including when **both**
  carry `1`.
- **AC-90** — IF both batches carry a recorded `metrics_version` (`>= 2`) and those versions differ,
  THEN the compare route shall set `incomparable_reason` to the stable code
  `metrics_version_mismatch`, a value distinct from AC-89's — "we do not know how this number was
  computed" and "these two were computed differently" are different things to tell a user, and the
  client's reason-key map resolves both.
- **AC-25** — WHILE `comparable` is `false`, the compare route shall set `delta.recall`,
  `delta.precision` and `delta.citation_accuracy` to `null` and shall still compute
  `delta.cost_usd`, which does not depend on the metrics formula.
- **AC-26** — The compare route shall set `old_config` and `new_config` from the `agent_versions`
  snapshot matching each batch's `agent_id` and `agent_version`, and shall set a side to `null` when
  no such snapshot exists.
- **AC-86** — IF a snapshot exists but fails `AgentVersionConfig.parse`
  (`server/src/modules/agents/helpers.ts:44-51` throws on a drifted `config_json`), THEN the compare
  route shall set that side's config to `null` and shall still respond `200`, so one unparseable
  historical snapshot degrades to AC-58's notice instead of failing the whole comparison.
- **AC-27** — The compare route's response shall contain no `actual_output` and no finding payload,
  so no model-authored text crosses this boundary.

**Promote route**

- **AC-28** — WHEN `POST /agents/:id/versions/:version/promote` succeeds, the agents service shall
  write that snapshot's `provider`, `model`, `system_prompt`, `output_schema`, `strategy`,
  `ci_fail_on` and `repo_intel` onto the agent row, set the agent's `version` to its previous
  `version + 1`, and insert an `agent_versions` snapshot for that new version.
- **AC-29** — WHEN a version is promoted, the agents service shall leave the agent's `name`,
  `description` and `enabled` unchanged, because `config_json` does not carry them
  (`server/src/modules/agents/repository.ts:175-184`).
- **AC-30** — WHEN a version is promoted, the agents service shall set `agent_skills.enabled` to
  `true` for exactly the skill ids in the snapshot's `skills` array and to `false` for every other
  link row of that agent.
- **AC-31** — IF a skill id in the snapshot has no `agent_skills` row for that agent but the skill
  still exists in the workspace, THEN the agents service shall insert an enabled link row for it,
  ordered after the agent's existing links.
- **AC-32** — IF a skill id in the snapshot names a skill that no longer exists, THEN the agents
  service shall skip it and return its id in `skills_not_restored`, and shall still apply the rest
  of the promotion.
- **AC-87** — IF a skill id in the snapshot names a skill that still exists but whose own `enabled`
  is `false`, THEN the agents service shall enable its link as AC-30 and AC-31 require **and** shall
  return its id in `skills_not_restored` — because `skillIdsForAgent` filters on `skills.enabled`
  (`server/src/modules/agents/repository.ts:225-239`), so that skill is absent from the snapshot the
  promotion itself writes and the new version is therefore **not** config-identical to the promoted
  one.
- **AC-88** — WHEN a version is promoted, the set union of the new version's snapshot `skills` and
  the returned `skills_not_restored` shall equal the promoted version's snapshot `skills`, so
  "which skills did not come back, for any reason" is answerable from the response alone.
- **AC-33** — IF `:version` equals the agent's current `version`, THEN the promote route shall
  respond `409` with code `conflict` and change no row.
- **AC-34** — IF an `eval_run_batches` row for that agent has `status` `queued` or `running`, THEN
  the promote route shall respond `409` with code `conflict` and change no row, so a sweep's
  configuration cannot change underneath it.
- **AC-35** — IF `:version` names a version with no `agent_versions` row, THEN the promote route
  shall respond `404` with code `not_found`.
- **AC-36** — WHEN the promote route succeeds, it shall respond `200` with an `EvalPromoteResult`
  whose `agent.version` equals the newly created version.

**Client — the per-agent eval view**

> Every criterion below names **the Evals tab** —
> `client/src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/` — as the host
> component, per `## Decisions`. Each is an addition to that tab's existing content, not a
> replacement of it: 0019's five tiles, "Run all evals" control and case list keep their criteria
> and their tests.

- **AC-37** — The Evals tab shall render three metric tiles — recall, precision, citation accuracy —
  each showing the `current` value and its `delta`.
- **AC-38** — IF a `current` metric is `null`, THEN its tile shall render the `evals` namespace's
  placeholder string and shall render neither `NaN`, nor `null`, nor `0%`, reusing `formatRatioTile`
  (`.../EvalsTab/helpers.ts:29-32`).
- **AC-39** — IF a `delta` is `null`, THEN its tile shall render the `evals` namespace's placeholder
  in place of the delta and shall render no direction indicator.
- **AC-40** — The Evals tab shall convey each delta's direction by a sign or word in text as well as
  by colour, satisfying WCAG 2.2 AA 1.4.1 (Use of Colour).
- **AC-41** — WHILE `alert` is non-null, the Evals tab shall render a banner whose text resolves
  through `next-intl` from the alert code and the `delta` values, and WHILE it is `null` shall render
  no banner.
- **AC-42** — The Evals tab shall render the trend as a `LineChart`
  (`client/src/vendor/ui/charts/LineChart.tsx`) with three series — recall, precision, citation
  accuracy — built by a pure helper in the tab's own `helpers.ts` from `trend`, with the three
  series' `data` arrays of equal length and index-aligned to the same points.
- **AC-43** — IF any of a trend point's three metrics is `null`, THEN the Evals tab's series helper
  shall omit that point from **all three** series rather than substitute a value for it.
- **AC-66** — The Evals tab shall pass `LineChart` only finite numbers: every element of every
  `ChartSeries.data` it builds shall satisfy `Number.isFinite`, and no `null` or `undefined` shall
  reach the primitive.
- **AC-67** — The Evals tab shall pass `yMin={0}` and `yMax={1}` to `LineChart` explicitly rather
  than relying on its defaults.
- **AC-44** — IF the plottable series hold fewer than two points, THEN the Evals tab shall render an
  empty-state message from the `evals` namespace in place of the chart.
- **AC-45** — IF either member of `trend_excluded` is greater than zero, THEN the Evals tab shall
  render a note naming each of the two server-supplied counts separately, deriving neither of them
  from `trend` or `recent_runs`.
- **AC-46** — The Evals tab shall render one recent-runs row per `recent_runs` entry carrying
  `ran_at`, the agent version, recall, precision, citation accuracy, `cases_passed` of `cases_total`
  and `cost_usd`.
- **AC-47** — The Evals tab shall render a selection checkbox on each recent-runs row whose `status`
  is `done` and shall render none on any other row.
- **AC-48** — The Evals tab shall render the Compare control disabled unless exactly two rows are
  selected.
- **AC-49** — WHILE exactly two rows are selected, the Evals tab shall render every unselected row's
  checkbox disabled.

**Client — the compare modal**

- **AC-50** — WHEN the Compare control is activated with two rows selected, the Evals tab shall
  request `GET /agents/:id/eval-runs/compare` for those two batch ids and open the compare modal.
- **AC-51** — The compare modal shall render a title carrying both version numbers in old-to-new
  order, resolved through `next-intl`.
- **AC-52** — The compare modal shall render four tiles — recall, precision, citation accuracy and
  cost — each showing the old value, the new value and the signed delta, with cost formatted by
  `formatCostTile` (`.../EvalsTab/helpers.ts:41-47`).
- **AC-53** — IF either side of a tile's metric is `null`, THEN that side shall render the `evals`
  placeholder and that tile's delta shall render the placeholder too.
- **AC-54** — WHILE `comparable` is `false`, the compare modal shall render a warning naming the
  reason, shall render the three metric deltas as the placeholder, and shall still render the cost
  delta.
- **AC-55** — The compare modal shall render a line-level diff of `old_config.system_prompt` against
  `new_config.system_prompt` from the rows returned by the **existing** `toDiffRows(older, current)`
  helper (`client/src/app/skills/_components/SkillDetail/_components/VersionsTab/helpers.ts:11`,
  built on the `diff` package's `diffLines`, returning `{ kind: "add" | "del" | "same", text }`),
  with no second diff implementation added.
- **AC-68** — `toDiffRows`, `DiffRow` and `DiffKind` shall be promoted to a shared module under
  `client/src/lib/` and imported from there by **both** `VersionsTab` and the compare modal, so that
  the `agents` feature never imports from the `skills` feature and the helper has exactly one
  definition. `VersionsTab`'s rendered output shall be unchanged by the move.
- **AC-56** — The compare modal shall mark each diff line by a text marker as well as by background
  colour, satisfying WCAG 2.2 AA 1.4.1.
- **AC-57** — The compare modal shall render both prompts as plain text, interpreting neither
  markdown nor HTML, so operator-authored prompt content cannot become markup.
- **AC-58** — IF `old_config` or `new_config` is `null`, THEN the compare modal shall render a notice
  from the `evals` namespace in place of the diff block and shall still render the four tiles.
- **AC-59** — IF the two prompts are identical, THEN the compare modal shall render a
  "no prompt change" message from the `evals` namespace rather than an empty diff block.
- **AC-60** — The compare modal shall render a promote control labelled with the **new** batch's
  version number.
- **AC-61** — IF the new batch's `agent_version` equals the agent's current `version`, THEN the
  compare modal shall render the promote control disabled with a reason in text, mirroring AC-33.
- **AC-69** — WHEN the promote control is activated, the compare modal shall render a confirmation
  dialog naming the version being promoted, the `model` that version's snapshot restores, and the
  number of skills that promotion will leave enabled, following the confirmation 0019's "Run all
  evals" already uses (`EvalsTab.tsx`, 0019 AC-60).
- **AC-70** — WHILE that confirmation is unanswered, the compare modal shall issue no
  `POST /agents/:id/versions/:version/promote`.
- **AC-71** — IF the confirmation is dismissed, THEN the compare modal shall issue no request, and
  the agent's `version` and `agent_versions` row count shall be unchanged.
- **AC-72** — WHEN the confirmation is accepted, the compare modal shall issue exactly one
  `POST /agents/:id/versions/:version/promote`.
- **AC-62** — WHEN the promote request succeeds, the compare modal shall render a confirmation from
  the `evals` namespace and the Evals tab shall refetch the agent and its dashboard.
- **AC-63** — IF the promote request fails, THEN the compare modal shall render the API error
  envelope's `error.message` inline and shall stay open.
- **AC-64** — WHEN the compare modal is open, pressing `Escape` shall close it and return focus to
  the Compare control.

**Client — per-run case detail**

- **AC-73** — The Evals tab shall render on every recent-runs row, in a trailing cell of its own, a
  `<button>` that opens that batch's case detail, with an accessible name identifying the run; the
  row element itself shall not be a click target and shall carry no `role="button"`.
- **AC-74** — WHEN that control is activated, the Evals tab shall request `GET /eval-runs/:batchId`
  for that row's batch and open the case-detail dialog.
- **AC-75** — The case-detail dialog shall render one row per entry of the response's `runs`,
  carrying the case name, the case's pass state as text, and its `recall`, `precision` and
  `citation_accuracy`.
- **AC-76** — WHILE the case-detail request is in flight, the dialog shall render a loading
  indicator with `role="status"` and an explicit `aria-label` from the `evals` namespace.
- **AC-77** — IF the case-detail request fails, THEN the dialog shall render the API error
  envelope's `error.message` and a retry control, and shall stay open.
- **AC-78** — IF the response's `runs` array is empty, THEN the dialog shall render an empty-state
  message from the `evals` namespace.
- **AC-79** — IF the response's `runs` array holds fewer entries than the batch's `cases_total`,
  THEN the dialog shall render a note naming the difference as cases deleted since the sweep ran.
- **AC-80** — IF a run's `case_name` is `null`, THEN the dialog shall render the `evals` namespace's
  placeholder in that cell and shall render neither `null` nor an empty cell.
- **AC-81** — The case-detail dialog shall render no part of a run's `actual_output` and no finding
  text, so the model-authored payload `GET /eval-runs/:batchId` carries is fetched but never
  displayed.

**Client — copy**

- **AC-65** — Every user-facing string the per-agent eval view, the compare modal, the promote
  confirmation and the case-detail dialog render shall resolve through `next-intl` from the
  existing `client/messages/en/evals.json`, with no literal copy in TSX and no new message
  namespace added.

**Enforcement split.** All 90 criteria are mechanically checkable: AC-1 through AC-3 by schema
introspection against a migrated database, AC-4 through AC-10 and AC-82 by contract parse tests
over both vendored copies, AC-11 through AC-36 and AC-83 through AC-90 by server route and service
tests, and AC-37 through AC-81 by client unit and component tests against fixtures. Nothing here is prompt behaviour — 0020 makes **no
model call at all**; every number it renders was produced by spec 0019 and every string it renders
is either an i18n message or stored text.

## Edge cases

| Case | Handling |
|---|---|
| **Comparing across the 2026-10-08 formula change** | The pair is `comparable: false`; the three metric deltas are withheld and a warning names the mismatch (AC-24, AC-25, AC-54). Both batches' own stored numbers are still rendered, each beside its own version's label — the falsehood is the *delta*, not the values. The cost delta survives, because money was never part of the formula change. |
| **Why stamp rather than backfill** | A backfill is computable in principle — a case row carries exactly one expectation (`specs/0019-evals.md` AC-18), so pooled recall and precision can be rederived from the stored `eval_runs` rows. It is declined because the rederivation needs each case's `expectation_kind` **as it was at run time**, and that column is mutable (`PATCH /eval-cases/:id`, 0019 AC-28) and its rows are deletable with cascade (0019 AC-29). A recomputed history would therefore be silently wrong for any case edited or deleted since — the precise failure this spec exists to prevent, reintroduced one layer down. What stamping buys, stated exactly: it partitions batches **by recorded formula**, and it compares only within a partition. It makes no claim about rows whose formula was never recorded, which is why AC-24 requires a recorded version and not merely an equal one. |
| **Every batch that predates this spec, including two of them compared with each other** | All of them are `1`, and `1` means *unrecorded*, not *the old formula* (AC-2). So none of them is comparable with anything — not with a post-migration sweep, and **not with each other** (AC-24, AC-89). **An earlier version of this spec got this wrong and said the opposite**, claiming the stamp "refuses comparisons that might have been valid and permits none that are not", and that backfilling to `1` was a safe false negative. It was neither. The dev database is the counterexample: all 8 existing batches carry `metrics_version = 1`, seven computed with the old rollup and the 2026-10-08 07:42 one with the current rollup; under a comparability test of mere equality those two groups are mutually comparable, and comparing them renders a stored precision of 0.35 against 1.00 as a **+65-point improvement that is entirely an artefact of the formula change** — a false positive, on the pair a user is most likely to pick, which is exactly the failure this spec exists to prevent. The error was treating `1` as the name of a formula. It is the absence of one, and two unknowns are not known-equal. |
| **The cost of that, stated plainly** | Every batch that exists before this ships compares with nothing. An old-prompt-vs-new comparison therefore needs **one fresh sweep of each configuration** after the migration; the existing history is readable — its own numbers, its costs, its case detail — but it is not a comparison baseline. That is the whole local history, not the stray run or two an earlier wording implied, and it is a real cost in model spend, accepted because the alternative is a product that renders a 65-point lie. |
| **A sweep whose metrics are `null`** | A vacuous pooled denominator yields `null` (0019 AC-18). Tiles render the placeholder (AC-38), deltas against it are `null` (AC-17, AC-39) and the run is dropped from the chart entirely (AC-43), counted in the exclusion note (AC-45). The number is absent, never zero. |
| **Why a null run is dropped from all three series rather than gapped in one** | `LineChart`'s `ChartSeries.data` is `number[]`, and its row builder is `row[s.name] = s.data[i] ?? 0` (`client/src/vendor/ui/charts/LineChart.tsx:15,35`): a missing element is coerced to **0** and drawn as a line touching the floor — a picture asserting total failure, needing no interaction to mislead, which is the cross-formula falsehood again in a worse form. The primitive cannot be fixed here: `client/src/vendor/ui` is "Do not touch" (root `AGENTS.md`), `nav.ts` is its only exception and does not apply, and `review_scope.py` raises a repo-rule `CRITICAL` on any edit there that no agent may downgrade. So the caller owns the problem. Dropping the whole point (not just the null series) is forced by the primitive's shape: the series are positional arrays sharing one hidden index axis (`:31-38`), so omitting a point from one series alone would shift every later point of that series onto the wrong x-position — a second falsehood traded for the first. |
| **A real metric of `0.00`** | Plotted, not clipped. `LineChart`'s `yMin` defaults to `0.6` (`:22`), which would silently push a genuine `0.00` or `0.30` below the drawn domain; AC-67 requires `yMin={0}` and `yMax={1}` to be passed explicitly. Live batches on this agent have recorded `recall 0.00` and `precision 0.00`, so this is observed behaviour, not a hypothetical. |
| **First run ever / exactly one `done` batch** | `current` populates, every delta is `null` (AC-17), the trend has one point so the chart is replaced by its empty state (AC-44) and no comparison is offerable — one row cannot be two selections (AC-48). |
| **No `done` batch at all** | `200` with nulls throughout (AC-18); the view renders placeholders, not an error. |
| **A `running`, `failed` or `cancelled` batch in the table** | Listed (AC-15, AC-46) so the history is honest, but not selectable (AC-47) and refused by the route if selected some other way (AC-23). A cancelled sweep's partial metrics must never enter a delta — the same rule 0019 applied to its cost tile. |
| **A case deleted after the sweep that scored it** | Deleting a case cascades its `eval_runs` rows away (0019 AC-29, `server/src/db/schema/eval.ts:129-135`), so an old batch's `runs` array can be **shorter than its own `cases_total`** while the batch's stored rollup still describes the full sweep. The dialog says so, naming the difference (AC-79), rather than letting a reader infer that 17 of 20 cases silently became 17 of 17. A run whose case row is gone but whose own row survives shows the `case_name` placeholder (AC-80) — `EvalRunRecord.case_name` is `nullish` precisely because it is denormalised. |
| **Opening case detail on a `queued` batch** | The request succeeds and `runs` is empty, so the dialog lands on its empty state (AC-78) rather than needing a per-status guard. The control is therefore on every row (AC-73), which is also what makes a `failed` or `cancelled` sweep's partial results readable — the rows written before the stop are still there (0019 AC-71). |
| **The detail control versus the selection checkbox in one row** | They are different cells and neither nests inside the other, and the row itself is not clickable (AC-73). This is not a style preference: a `role="button"` wrapper concatenates its descendants' text into its own accessible name, so every regex name query on the subtree becomes ambiguous — `FindingCard`'s header is the repo's recorded instance (`client/INSIGHTS.md:126-130`), and `client/INSIGHTS.md:175-179` records the same breakage from a vendored `Chip`, which is unconditionally a `<button>` even with no `onClick`. So the detail affordance is a plain `<button>` in its own cell, any status indicator beside it is a `Badge` (a `<span>`) and never a `Chip`, and the test queries by exact accessible name. |
| **Selecting a third run** | Unreachable: at two selections every other checkbox is disabled (AC-49), so there is no "which two did it pick" ambiguity to resolve. |
| **The user selects newest first, then oldest** | The route orders by `ran_at`, not by argument order (AC-20), so the modal's "old → new" never inverts. |
| **Two batches of the same agent version** | Perfectly legal — re-running an unchanged agent. The prompt diff then renders "no prompt change" (AC-59) and the metric deltas show the run-to-run variance 0019's `## Non-functional` warns is unquantified. The promote control is disabled if that version is already current (AC-61). |
| **A missing `agent_versions` snapshot** | `old_config` / `new_config` is `null` (AC-26) and the diff block becomes a notice while the tiles still render (AC-58). Reachable when a batch's `agent_version` predates a snapshot gap; the metrics half of the modal must not be lost with the prompt half. |
| **Promoting the version that is already current** | `409` (AC-33), and the control is disabled before the user can try (AC-61). Allowing it would append a duplicate version to history for no change. |
| **Promoting while a sweep is running** | `409` (AC-34). The executor resolves provider and skills once at batch start (0019 AC-39, AC-43), so a mid-sweep config change would produce a batch whose `agent_version` column no longer describes what ran — the stamp would lie in the same way the formula change does. |
| **A skill that was linked at the promoted version and has since been deleted** | Skipped and named in `skills_not_restored` (AC-32); the rest of the config still lands. A promote that silently dropped a skill would recreate a configuration that scores differently from the one being promoted. |
| **A skill that still exists but is globally disabled** | Its link is enabled, but `skillIdsForAgent` filters on `skills.enabled` (`server/src/modules/agents/repository.ts:225-239`), so it is missing from the snapshot the promotion writes — the restored version is not config-identical to the one promoted. Reported in `skills_not_restored` (AC-87) rather than documented as an asymmetry, because the field's job is "what the promoted snapshot named and the new one does not carry", and AC-88 turns that into an arithmetic invariant a test can check. The alternative — enabling the skill globally on the agent's behalf — was rejected: a global toggle is not this agent's to flip, and silently re-enabling a skill someone disabled across the workspace is a much larger action than the one the user asked for. |
| **A snapshot that exists but no longer parses** | `toAgentVersionDto` runs `AgentVersionConfig.parse` on untyped `config_json` and throws on drift (`server/src/modules/agents/helpers.ts:44-51`), which would 500 the whole comparison over one old row. Treated as that side being `null` (AC-86), landing on the same notice as a missing snapshot (AC-58): one unreadable history entry costs the prompt diff, never the metrics. |
| **A skill that was linked then unlinked** | The link row is recreated, enabled, appended after existing links (AC-31). Link order affects prompt assembly, so the restored order is "snapshot's skills last" rather than the original interleaving — a known, bounded imprecision, visible in the agent's Skills tab. |
| **Promote races a concurrent agent edit** | Last write wins at the row, and both paths bump the version through the same `AgentRepository.update` snapshot machinery (`repository.ts:132-166`), so no version number is ever reused and the losing edit is recoverable from history. Not guarded further: this repo has one workspace and no per-user roles. |
| **A very long system prompt** | The diff block scrolls within a bounded height rather than growing the modal (`## Non-functional`); the diff helper is line-level and O(n·m) only in changed-region size. |
| **A prompt containing markdown, HTML or emoji** | Rendered as text through React's default escaping, with no markdown renderer in the diff path (AC-57). The prompt is operator-authored, but it is still never markup here. |
| **Long / RTL agent and skill names in the table** | Truncated with an ellipsis at the container width (`## Non-functional`), as 0019 already requires of case rows. |
| **A batch whose `cost_usd` is `null`** | One unpriced model makes the whole sweep's cost unknown (0019 AC-65). The cost tile renders the placeholder via `formatCostTile` and the cost delta is `null` (AC-52, AC-53). |
| **Time zones on `ran_at`** | `ran_at` is `timestamptz`; the table renders it in the viewer's locale through the client's existing date formatting, and all ordering happens server-side on the stored instant (AC-15, AC-20), so a display time zone can never change which batch is "old". |
| **A workspace boundary** | Every route scopes by the request's workspace and `404`s otherwise (AC-19, AC-21). |

**Checked and ruled out** (so a reader can disagree with the dismissal rather than never see it):
*pagination* — `recent_runs` is capped at 10 and `trend` at 20 by AC-14 and AC-15, with no cursor,
because an agent accumulates sweeps at human speed; *permission denied* — the API has one workspace
and no per-user roles today; *two writers at once* on a batch — batches are immutable once terminal,
so the only concurrent write 0020 can race is the promote/edit pair, handled above; *offline and
stale reads* — the view is TanStack Query over the same cache policy as the rest of the Evals tab
and adds no new staleness rule; *negative or non-dividing numbers* — metrics are ratios in `[0,1]`
or `null` by construction, and a delta is therefore in `[-1,1]`; *a deleted parent* —
`eval_run_batches.agent_id` cascades from `agents` (`server/src/db/schema/eval.ts:94-96`), so a
deleted agent takes its batches with it and there is no orphan to render.

## Non-functional

- **A withheld delta is a feature, not a degradation.** The only honest states are "a number" and
  "unavailable, because X". `0`, `—` without a reason, and a number computed across formulas are all
  forbidden by AC-17, AC-25 and AC-39.
- **What the stamp cannot do.** `metrics_version` records which rollup *the code believed it was
  running*. It does not verify it: a future edit to the rollup that forgets to bump the constant
  produces rows that claim comparability they do not have, and nothing at runtime can detect that.
  The mitigation is that the constant and the rollup live in one file and AC-3 makes the pairing a
  named review target — not that the system is self-checking. Nor does the stamp help across a
  change to the *scorer* (`scoreEvalCase`) rather than the rollup, which would shift the same metric
  without touching the batch formula; that boundary is unmodelled and 0020 does not claim otherwise.
  And it says nothing at all about rows stamped `1`: that value is the absence of a record, so the
  only sound thing to do with it is refuse (AC-24, AC-89), which is what makes the whole
  pre-migration history a readable archive rather than a baseline. The first draft of this spec
  claimed the stamp could only err toward refusing — it could not, while comparability was mere
  equality, and the live database proved it (`## Edge cases`).
- **Query budget.** `GET /agents/:id/eval-dashboard` shall answer in at most two queries (the batch
  list, the case count) and the per-agent view's initial paint shall issue at most **four** API
  requests — the three 0019's tab already makes (cases, batches, latest batch detail) plus this
  spec's dashboard. That is a ceiling on a number already reached, not a target: the budget worth
  defending is the next clause. Opening the compare modal issues exactly one more request and
  opening a row's case detail exactly one more, both **strictly on demand** — no row prefetches its
  case detail, and nothing is fetched per row at paint. No per-batch version fetch either; the compare route resolves both snapshots
  server-side (AC-26).
- **Latency.** The dashboard route reads at most 20 rows of one indexed table and shall answer within
  200 ms at p95 on the dev stack; the prompt diff is computed client-side on at most two strings and
  shall not block interaction for more than 50 ms on a 20 KB prompt.
- **Accessibility (WCAG 2.2 AA).** Delta direction and diff line kind are each conveyed in text as
  well as colour (AC-40, AC-56); the chart has a text alternative in the recent-runs table, which
  carries the same numbers; the row checkboxes and the Compare control are keyboard reachable in
  document order; the modal traps focus, closes on `Escape` and restores focus to its opener
  (AC-64). The case-detail dialog's loading indicator carries `role="status"` **and** its own
  `aria-label` (AC-76), because `status` is name-from-author-only and takes no name from its text
  content, in jsdom or in a browser (`client/INSIGHTS.md:144-149`). The recent-runs row exposes two
  separate controls and is not itself one (AC-73), for the accessible-name reason in
  `## Edge cases`. Note the known constraint: the vendored `Modal` renders its title in a plain
  `div` with no heading role but does set `role="dialog" aria-modal="true"`
  (`client/INSIGHTS.md:120-123`), so AC-51's and AC-69's titles are queried as
  `within(getByRole("dialog")).getByText(...)`, and adding a heading role would be a change to
  vendored UI and therefore out of scope here.
- **Layout.** The three tiles wrap at phone width; the recent-runs table scrolls horizontally rather
  than compressing its numeric columns; the prompt diff block scrolls within a bounded height inside
  the modal; agent, skill and file names truncate with an ellipsis.
- **No vendored UI changes.** The diff touches no file under `client/src/vendor/ui/` — not
  `charts/LineChart.tsx` (AC-43, AC-66 and AC-67 put every accommodation in the caller) and not
  `nav.ts` (`## Decisions`). This is a review check rather than an `AC-N` because it constrains the
  diff and not the product; the standing guard is `review_scope.py`, which raises a repo-rule
  `CRITICAL` on such an edit, and `git diff --name-status client/src/vendor/`.
- **New copy goes in the existing `evals.json`, and no namespace is minted.** Every
  `client/messages/en/*.json` catalogue is shipped to every route, so a new namespace is payload on
  pages that never render this view (`client/INSIGHTS.md:52-58`). AC-65 names `evals.json` for that
  reason, and the alert codes of AC-16 resolve to keys inside it.
- **Every new contract is a type-only import in client code.** A *value* import from
  `@devdigest/shared` passes `pnpm typecheck` and vitest and still breaks `next dev` / `next build`
  (`client/INSIGHTS.md:83-89`), so `EvalDashboard`, `EvalRunComparison` and `EvalPromoteResult` enter
  the tab and the modal as `import type`. Runtime parsing of those payloads, if any is wanted, stays
  on the server side of the boundary.
- **Money is never a binary float.** Costs continue to cross the repository boundary as strings and
  convert with `Number()` / `String()` (`server/INSIGHTS.md:144-150`); the cost delta is a
  subtraction of two already-converted numbers for display only and is never persisted.
- **No new model call and no new spend.** 0020 adds no provider call on any path; the only cost it
  can cause is the sweep 0019's existing "Run all evals" control starts.

## Inputs (provenance)

| Input | Source | Provenance | Notes |
|---|---|---|---|
| Batch rows — metrics, `cases_passed`, `cases_total`, `cost_usd`, `status`, `ran_at` | `GET /agents/:id/eval-runs` / `eval_run_batches` | `[reused: spec 0019]` | The dashboard reads the same rows the Evals tab already reads; no second write path. |
| `agent_version` on each batch | `eval_run_batches.agent_version` | `[reused: spec 0019]` | 0019 stored it precisely so 0020 could diff configurations (0019 AC-38). |
| Version config snapshots — `provider`, `model`, `system_prompt`, `output_schema`, `strategy`, `ci_fail_on`, `repo_intel`, `skills` | `agent_versions.config_json` via `AgentRepository.getVersion` (`repository.ts:201-207`) | `[reused: spec 0006]` | Parsed through `AgentVersionConfig` (`contracts/knowledge.ts:446-455`), so a drifted old snapshot throws at the boundary rather than leaking. |
| Agent current `version`, `name`, `description`, `enabled` | `agents` row | `[reused: spec 0006]` | Decides AC-33's conflict and AC-29's untouched set. |
| Linked-skill state | `agent_skills` + `skills` via `AgentRepository.skillIdsForAgent` (`repository.ts:225-239`) | `[reused: spec 0006]` | The promote target for AC-30 to AC-32. |
| `recall`, `precision`, `citation_accuracy` per batch | 0019's rollup over `scoreEvalCase` | `[deterministic: pure functions in reviewer-core + the server rollup helper]` | No model on this path; the model's output was the scorer's *input*, one spec ago. |
| Deltas, trend series, alert code | this spec's dashboard service | `[deterministic: arithmetic over stored batch rows]` | Subtraction and a threshold; nothing is inferred. |
| `metrics_version` | this spec | `[new]` | A constant written at batch creation (AC-3) and backfilled to `1` for history (AC-2). |
| The prompt diff | `toDiffRows` over the two snapshots' `system_prompt` — the existing helper at `VersionsTab/helpers.ts:11`, on the `diff` package's `diffLines` | `[reused: spec 0006]` | Computed in the browser; never sent to a model, never persisted. 0020 is its second consumer, which is what promotes it to `client/src/lib/` (AC-68) rather than copying it. No new dependency: `diff` is already a direct client dependency. |
| Agent-authored system prompt text | `agent_versions.config_json.system_prompt` | `[reused: spec 0006]` | Operator-authored; rendered as text (AC-57), never re-prompted by 0020. |

## Untrusted inputs

0020 makes **no model call and assembles no prompt**, so there is no `wrapUntrusted()` obligation on
any new code path — but two of the things it touches are untrusted in the senses that still matter,
and one of them is untrusted in a way that is easy to mis-classify.

- **The system prompt rendered in the diff is operator-authored, and it is still not safe as
  markup.** It is written by a user of this studio, not by a stranger, so it is not a
  prompt-injection surface *here* — 0020 never puts it into a prompt; it only displays it. What it
  is, is arbitrary text going into the DOM: a prompt containing `<script>`, markdown, or
  backtick-fenced HTML must render as the characters the author typed. AC-57 requires plain-text
  rendering with no markdown or HTML interpretation, which is React's default and must not be
  opted out of with `dangerouslySetInnerHTML` or a markdown renderer "to make the diff prettier".
  Note what remains true upstream and unchanged: the same prompt **is** sent to a model on every
  review and eval run, and `wrapUntrusted()`'s limits there (`reviewer-core/src/prompt.ts:30-34`,
  `server/INSIGHTS.md` 2026-10-06) are 0006's and 0019's problem, not 0020's.
- **The findings behind a run are model output, and 0020 excludes them.** `eval_runs.actual_output`
  holds grounded findings produced by an LLM against a stranger's diff. They are a source of
  numbers, never of truth or of instruction, and the compare response carries none of them (AC-27).
  `EvalDashboard.recent_runs` becoming `EvalBatchRecord[]` (AC-7) keeps them off the dashboard
  payload too — the per-case `EvalRunRecord` carries `actual_output` as `z.unknown()`. One path
  remains and it is deliberate: the case-detail dialog fetches `GET /eval-runs/:batchId` (AC-74),
  whose `runs` **do** carry `actual_output`, because that route is 0019's and 0020 adds no route of
  its own. The obligation therefore moves to the renderer — AC-81 forbids displaying any part of it,
  and AC-75 enumerates the five fields that are displayed. If a later change wants to show a
  finding's text here, it inherits 0019's untrusted-input rules in full and this section must be
  rewritten: model-authored text rendered as markup is the failure mode, and `<script>` in a
  finding's message is exactly as plausible as it is in a system prompt.
- **`eval_cases.input_diff` — stranger-authored code — is read by nothing in 0020.** The dashboard
  and the compare view read batch rollups and version snapshots only. If a later change renders case
  content here, 0019's `## Untrusted inputs` applies in full and this section must be rewritten.

## Test plan

| Criteria | How |
|---|---|
| AC-1, AC-2, AC-3 | `server/` integration test (`eval-metrics-version.it.test.ts`) against the migrated database: `eval_run_batches` has a NOT NULL `metrics_version`; an insert omitting it takes the current constant, which is `>= 2`; a row inserted before the migration (simulated by inserting then running the backfill statement's predicate) reads `1`. A static assertion pins the constant `>= 2`, so `1` can never be handed out as a live stamp — it is reserved for "unrecorded" (AC-2) and AC-24 refuses it. Plus a `server/` unit test asserting the executor writes the exported constant, and a negative control: a batch inserted by the repository with the constant stubbed to `99` round-trips `99`, so the test reads the constant rather than hard-coding today's value twice. |
| AC-4, AC-5, AC-6, AC-7, AC-82 | `server/` unit test over the barrel: `EvalDashboard.parse` accepts `trend_excluded: { other_version: 0, incomplete_metrics: 0 }`, rejects a body omitting `trend_excluded`, and rejects a negative or fractional count. `EvalBatchRecord.parse` accepts a row with `metrics_version: 2` and rejects one with it absent; `EvalTrendPoint.parse` and `EvalDashboard.parse` both accept a fixture with `recall: null`, `precision: null`, `citation_accuracy: null` on every nested object — **the parse that fails today** — and `EvalDashboard.parse` accepts `recent_runs` holding two `EvalBatchRecord` fixtures and rejects one holding an `EvalRunRecord`. Negative controls: `EvalTrendPoint` still rejects `recall: "0.8"`, and a key-set snapshot of each schema proves nothing pre-existing was renamed or removed. |
| AC-8, AC-9 | `server/` unit test: both schemas are exported from the barrel; `EvalRunComparison.parse` accepts a full fixture, accepts one with `old_config: null` and `delta.recall: null`, and rejects `comparable: "false"`; `EvalPromoteResult.parse` accepts `skills_not_restored: []` and rejects a missing `agent`. |
| AC-10 | `client/` unit test importing `EvalBatchRecord`, `EvalTrendPoint`, `EvalDashboard`, `EvalRunComparison` and `EvalPromoteResult` from **both** copies of `contracts/eval-ci.ts` and asserting identical `safeParse` verdicts over a shared fixture table (two valid rows, three invalid). Negative control: one contract this spec does not touch is compared the same way, so the test fails on an unrelated client-side edit. Plus a static assertion over every file this feature adds under `client/src/app/agents/`: each import from `@devdigest/shared` is `import type`. A **value** import passes `pnpm typecheck` and vitest and still breaks `next dev` / `next build` (`client/INSIGHTS.md:83-89`), so no test in this lane can catch it — which is why it is asserted on the source text instead. |
| AC-11, AC-12, AC-15, AC-19 | `server/` integration test (`eval-dashboard.it.test.ts`): seed four batches for one agent (two `done`, one `cancelled`, one `failed`) plus a batch for a second agent and one in a second workspace; assert `owner_id`, that `current` equals the newest `done` row's metrics and that `traces_passed`/`traces_total` equal its `cases_passed`/`cases_total`; `recent_runs` returns all four of this agent's batches newest-first and neither foreign row; an unknown agent id and a foreign-workspace agent id each return `404 not_found`. |
| AC-13, AC-14, AC-17 | `server/` unit test on the dashboard aggregation helper over fixture batch lists: three `done` batches all of `metrics_version: 2` → each delta is newest minus the one before it and `trend` is all three ascending by `ran_at`; a newest batch of `metrics_version: 2` over a history of `1` → deltas `null` and `trend` holds **only** the version-2 point; **an agent whose batches are all `metrics_version: 1` → every delta `null` and `trend` empty**, the dashboard half of the same defect AC-24 fixes in the compare route — an equality-only predicate would have plotted those eight runs as one comparable series and computed deltas across the formula change; 25 same-version batches → `trend` holds the 20 most recent; a `current` with `precision: null` → that delta `null` while the other two are numbers; a single `done` batch → all deltas `null`. Negative control: a case where every delta is a real number, so a helper that returned `null` unconditionally fails. |
| AC-16 | `server/` unit test table: delta `-0.02` → `precision_drop` (boundary inclusive); `-0.019` → `null`; two metrics below the threshold → the code of the **lower** one; all deltas positive → `null`; every delta `null` → `null`. The assertion is on the code string, and a second assertion proves the returned value is not human-readable prose (no space character), pinning AC-16's "code, never prose". |
| AC-18, AC-85 | `server/` integration test: an agent with eval cases and no batch at all → `200`, every nullable `current` and `delta` metric `null`, `trend` `[]`, `recent_runs` `[]`, `alert` `null`, `cases_total` equal to its case count — **and `traces_passed` and `traces_total` exactly `0`, not `null`**, asserted with `toBe(0)` so a `null` that happens to be falsy fails. The response is also run through `EvalDashboard.parse` in the test, which is what would have caught the contradiction had the two fields been widened instead. Negative control: the same agent after one `done` batch returns numbers in all of them. |
| AC-83 | `server/` unit test on the dashboard aggregation helper: an agent with 14 `done` batches — 9 of the current `metrics_version: 2`, of which 2 carry a `null` metric, plus 5 stamped `1` — yields `trend` of 7 points and `trend_excluded` of `{ other_version: 5, incomplete_metrics: 2 }`. Second fixture: an agent whose every `done` batch is stamped `1` → `trend` empty and `other_version` equal to the full count, since an unrecorded `current` makes nothing comparable (AC-14). The fixture deliberately exceeds `recent_runs`' 10-row cap and the trend's own length, so a count derived from either array is wrong; a `cancelled` batch and a `failed` one are present and counted in neither. |
| AC-84 | `server/` unit test computing the delta **from two metric values** rather than passing one in: `current.precision = 0.02` against a previous `0.04` → `alert` is `precision_drop`, even though the subtraction yields `-0.019999999999999997`. This is the case AC-16's boundary row cannot see, because it hands the comparison a literal. Negative control in the same table: `0.02` against `0.039` (a genuine 1.9-point drop) → `null`, so the tolerance did not become a free point of slack. |
| AC-86 | `server/` integration test: write a deliberately drifted `config_json` (a `provider` value outside the enum) onto one of the two versions, then compare → `200` with that side's config `null` and the other side's populated, no `500`, and `EvalRunComparison.parse` accepting the body. Negative control: both snapshots valid → both configs populated. |
| AC-87, AC-88 | `server/` integration test extending AC-30's fixture with a fifth skill, linked and named in the snapshot, whose own `skills.enabled` is `false`: after promote its link row is enabled, its id is in `skills_not_restored` alongside the deleted skill's, and the new `agent_versions` snapshot's `skills` omits it. The invariant is then asserted directly as a set: new snapshot `skills` ∪ `skills_not_restored` equals the promoted snapshot's `skills`, and the test repeats that assertion over the plain case where nothing is missing (the union equals the original and `skills_not_restored` is empty), so the check is not satisfied by a response that reports everything as unrestored. |
| AC-20, AC-21, AC-22, AC-23 | `server/` integration test: two `done` batches compared with the ids supplied newest-first and then oldest-first return byte-identical bodies with `old` the earlier `ran_at`; an unknown id, another agent's batch id and another workspace's batch id each → `404 not_found`; the same id twice → `422 validation_error`; a `cancelled` batch and a `running` batch each → `422` with the status named in the message. |
| AC-24, AC-25, AC-89, AC-90 | `server/` integration test over a four-case table, which exists because the three-line version of it is what let the original defect through: (a) two batches both `metrics_version: 1` → `comparable: false` with `incomparable_reason` `metrics_version_unrecorded` — **the case that previously returned `comparable: true` and rendered a 65-point artefact as an improvement**; (b) `1` against `2` → `false`, same `unrecorded` code, since an unknown on either side decides it; (c) `2` against `3` → `false` with `metrics_version_mismatch`; (d) **positive control**, two batches both `metrics_version: 2` → `comparable: true`, `incomparable_reason` `null` and all four deltas numeric, so the fix does not degenerate into "nothing is ever comparable". A fifth assertion pins the two codes as distinct string literals, so collapsing them into one message key fails. For (a) through (c), `delta.recall`/`precision`/`citation_accuracy` are `null` while `delta.cost_usd` is the arithmetic difference of the two costs. |
| AC-26, AC-27 | `server/` integration test: both configs come back parsed, with `system_prompt` equal to each version's snapshot; deleting one `agent_versions` row → that side `null` and the other side still populated; a deep key scan of the response body finds no `actual_output` and no `findings` key. |
| AC-28, AC-29, AC-36 | `server/` integration test (`agent-promote.it.test.ts`): an agent at v3 whose v1 snapshot differs in `model`, `system_prompt`, `strategy`, `ci_fail_on`, `repo_intel` and `output_schema` → after promoting v1 the agent row matches v1 on all seven config fields, its `version` is `4`, an `agent_versions` row exists for `4` with config equal to v1's, and `name`, `description` and `enabled` are unchanged. The response's `agent.version` is `4`. Negative control: v1's and v3's `name` differ in the fixture, so a promote that restored the whole row rather than the config would fail. |
| AC-30, AC-31, AC-32 | `server/` integration test over an agent with four link rows: a snapshot naming skills A and C, where A is linked-disabled, B is linked-enabled, C is not linked at all and D is in the snapshot but its `skills` row has been deleted → after promote, A and C are linked and enabled, B is linked and disabled, C's new row sorts after the pre-existing links, D appears in `skills_not_restored` and no row is created for it, and the promotion's config fields still landed. |
| AC-33, AC-34, AC-35 | `server/` integration test: promoting the agent's current version → `409 conflict` with the agent row unchanged; promoting any version while a seeded `running` batch exists for that agent → `409 conflict`, and the same request after that batch is set `done` → `200` (the positive control that the guard is about liveness, not about the agent); promoting a version number with no snapshot → `404 not_found`. |
| AC-37, AC-38, AC-39, AC-40 | `client/` component test against dashboard fixtures: three tiles render the fixture's values and deltas; a fixture with `current.precision: null` renders the placeholder in that tile while the other two show percentages, and the DOM contains neither `NaN`, `null` nor `0%` in that tile; a fixture with `delta.recall: null` renders the placeholder and no direction indicator; a positive and a negative delta each render a sign or word in the accessible text, asserted with colour-carrying class names ignored. |
| AC-41 | `client/` component test: `alert: "precision_drop"` with `delta.precision: -0.02` renders a banner whose text comes from the message catalogue and contains the formatted delta; `alert: null` renders no banner (queried by role `alert` / test id, asserted absent). |
| AC-42, AC-43, AC-66 | `client/` unit test on the tab's series helper, which is where the whole accommodation lives: a five-point trend yields three `data` arrays of length 5 in point order; a trend whose middle point has `citation_accuracy: null` yields three arrays of length **4** with the same surviving points in the same positions in each — asserted by checking that `recall[2]` is the fourth point's recall in all three series, so a helper that dropped the point from one series only fails on index alignment; every element of every array satisfies `Number.isFinite`, and no element is `null`, `undefined` or a substituted `0`. Negative control: a fixture with no nulls keeps all five points, so the helper is not simply discarding data. Plus a static assertion that no file under `client/src/vendor/ui/` appears in this feature's diff — `LineChart` is not modified, which is why the helper must do this. |
| AC-67 | `client/` component test: the rendered `LineChart` receives `yMin` `0` and `yMax` `1` (asserted on the props handed to a stubbed primitive). Negative control with a real value: a trend containing a `0.00` metric — observed live on this agent — renders inside the drawn domain rather than below it, which the primitive's `yMin` default of `0.6` (`LineChart.tsx:22`) would have clipped. |
| AC-44, AC-45 | `client/` component test: a trend reduced to one plottable point renders the empty state instead of the chart; a fixture whose `trend_excluded` is `{ other_version: 3, incomplete_metrics: 2 }` renders the note carrying **both** counts separately, and `{ 0, 0 }` renders no note. The decisive assertion is that the counts come from the payload and not from the arrays: the same fixture ships a `trend` of 5 points and a `recent_runs` of 10, numbers that match neither `3` nor `2`, so any client-side derivation produces a wrong figure and fails. |
| AC-46, AC-47, AC-48, AC-49 | `client/` component test: four `recent_runs` fixtures (two `done`, one `running`, one `failed`) render four rows with every listed column; only the two `done` rows have a checkbox; Compare is disabled at zero and at one selection and enabled at two; with two selected, the test asserts there is no third enabled checkbox — and, as the negative control, that deselecting one re-enables the others. |
| AC-50, AC-51, AC-52, AC-53 | `client/` component test: activating Compare with two selections issues exactly one `GET …/compare` carrying both ids and opens the modal; the title contains both version numbers in old→new order (queried **by text, not `getByRole("heading")`** — the vendored `Modal` renders its title in a plain `div`, `client/INSIGHTS.md:120-126`); four tiles render old, new and signed delta, with cost formatted by `formatCostTile`; a fixture whose `old.precision` is `null` renders the placeholder on that side and for that delta while the three other tiles still show numbers. |
| AC-54 | `client/` component test: `comparable: false` renders the warning, the three metric deltas as placeholders and the cost delta as a number — run twice, once per reason code, asserting `metrics_version_unrecorded` and `metrics_version_mismatch` resolve to **different** `evals.json` messages, so a reason-key map missing one renders a raw code and fails. Positive control: the same fixture with `comparable: true` and `incomparable_reason: null` renders no warning and four numeric deltas. |
| AC-55, AC-68 | `client/` unit test on the promoted `toDiffRows` in its new `client/src/lib/` home, carried over from and extended beyond `VersionsTab`'s existing coverage: identical strings → every row `same`; one line appended → one `add` and no `del`; one line deleted → one `del`; a line edited → one `add` and one `del`; an empty older string → every row `add`; a trailing-newline difference → no spurious rows (the helper strips one trailing `\n` per part, `helpers.ts:15`). Plus two structural assertions: `VersionsTab` imports the helper from `client/src/lib/` and no longer defines it, and its own existing test file passes unchanged (the behaviour-preserving half of the move); and no file under `client/src/app/agents/` imports from `client/src/app/skills/`, so the reuse went through the shared module and not across features. Negative control: the `VersionsTab` assertion is paired with a check that the helper file under `skills/` no longer exports `toDiffRows`, so a copy-paste that left both definitions in place fails. |
| AC-56, AC-59 | `client/` component test on the modal's diff block: `add` and `del` rows each carry a text marker in their accessible content, asserted with colour-carrying class names ignored; two identical prompts render the "no prompt change" message and no diff rows. |
| AC-57 | `client/` component test: a prompt containing `<script>alert(1)</script>`, `**bold**` and a fenced code block renders those characters verbatim in the DOM with no `<script>`, `<strong>` or `<pre>` element produced by the diff block. Plus a static assertion that no file under the compare modal's folder references `dangerouslySetInnerHTML` or a markdown renderer. |
| AC-58 | `client/` component test: `old_config: null` renders the notice and still renders all four tiles; `new_config: null` does the same. Negative control: both configs present renders the diff and no notice. |
| AC-60, AC-61, AC-62, AC-63 | `client/` component test: the promote control's label contains the new batch's version number; with the agent's current version equal to the new batch's, it renders disabled with a reason in text; a successful `POST …/promote` renders the confirmation and triggers a refetch of the agent and dashboard queries (asserted on the query client's invalidations); a `409` envelope renders `error.message` inline with the modal still mounted. |
| AC-69, AC-70, AC-71, AC-72 | `client/` component test: activating promote renders the confirmation and the test reads its content out of `within(getByRole("dialog"))` by text — **never `getByRole("heading")`**, which can never match the vendored `Modal`'s plain-`div` title (`client/INSIGHTS.md:120-123`) — asserting it names the version number, the model string from `new_config.model` and the skill count from `new_config.skills.length`; `fetch` has recorded no `POST …/promote` at that point; dismissing it leaves the request count at zero and fires no mutation; accepting it issues exactly one `POST` to the path carrying the promoted version. Negative control: the skill count is asserted against a fixture with **two** skills and a second with **zero**, so a hard-coded string fails. |
| AC-73, AC-74 | `client/` component test: each of four recent-runs rows exposes a detail `<button>` in its own cell with an exact accessible name naming that run; the `<tr>` has no `onClick` and no `role="button"`. Controls are queried by **exact** accessible name, because a wrapper control concatenates its descendants' names and makes every regex query on the subtree ambiguous (`client/INSIGHTS.md:126-130`, `:175-179`); the same assertion proves the checkbox and the detail button resolve to two distinct elements. Activating the button issues exactly one `GET /eval-runs/:batchId` for **that row's** batch id — asserted against the third row, so an implementation always opening the first row's batch fails — and opens a dialog. |
| AC-75, AC-80, AC-81 | `client/` component test against a two-entry `runs` fixture: two rows carrying case name, pass state as text (asserted with colour-carrying class names ignored) and the three metrics; a run with `case_name: null` renders the placeholder and the DOM holds neither the string `null` nor an empty cell there; a fixture whose `actual_output` holds the distinctive string `INJECTED-FINDING-TEXT` renders nowhere in the dialog, and a static assertion confirms no component under the dialog's folder reads `actual_output`. |
| AC-76, AC-77, AC-78, AC-79 | `client/` component test: while the request is pending the dialog exposes `getByRole("status", { name: … })` resolved against its **`aria-label`** — `status` takes no accessible name from its text content, in jsdom or a browser (`client/INSIGHTS.md:144-149`), so asserting the visible copy would be the wrong query and would pass for the wrong reason; a `500` envelope renders `error.message` plus a retry control with the dialog still mounted, and activating retry issues a second request; `runs: []` renders the empty state; `runs` of length 17 against a batch whose `cases_total` is 20 renders the note naming `3`. Negative control: 20 of 20 renders no note. |
| AC-64 | `client/` component test: with the compare modal and then the case-detail dialog open, `Escape` unmounts each and focus returns to the control that opened it (`document.activeElement`). |
| AC-65 | `client/` component test rendered with an empty message catalogue: every string the per-agent view and the modal show resolves to a missing-key marker rather than readable English — a literal in TSX survives and fails the assertion. Plus a static assertion that `client/messages/en/` gained no file: all new keys live in the existing `evals.json`, because every catalogue ships to every route (`client/INSIGHTS.md:52-58`). |
| — | Manual walk on `./scripts/dev.sh`, and it is the only check of the thing this spec exists for: take an agent with a real eval set, run a sweep, degrade its system prompt, run a second sweep, then select both runs and confirm the modal names the two versions, shows the metric that moved, highlights exactly the prompt lines that changed, and that "Promote" — after a confirmation naming the version, the model and the skill count — restores the earlier prompt and model, after which a third sweep returns the metrics to roughly their first values. Then open the *first* sweep's case detail from its recent-runs row and confirm the case that flipped is identifiable there, which is the question the deltas raise and cannot answer. |
| — | Manual walk, second half — the comparability guard against live history, which is where the defect was found and not where it was predicted: select **two of the eight existing `metrics_version = 1` batches** and confirm the modal refuses the metric deltas with the *unrecorded* reason rather than comparing them (this pair rendered a +65-point artefact before AC-24 required a recorded stamp); then select one of them against a post-migration sweep and confirm the same refusal; then two post-migration sweeps and confirm they **do** compare. Confirm the trend chart is empty for an agent with only legacy batches and says how many it excluded, and that both runs' own numbers, costs and case detail are still readable throughout. |

## Phases

| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-10-08 | Request came from the user hitting the gap in the running app: no way to compare two eval runs. 0019 read first — it names this feature as its own deferred successor. Mockups were never in `design/`; the three relevant screens staged as `design/eval-dashboard/` from the original brief. `scripts/insights-for.sh` run over the four affected paths (87 of 223 entries route to them). Facts settled before the spec asserted anything: `EvalTrendPoint` / `EvalDashboard` already exist and are unreferenced; their metrics are non-nullable and would fail to parse post-`1a5b2c8` data; `GET /agents/:id/versions` returns `config` with `system_prompt`; and the stored run history spans a metric formula change — measured, six pre-fix batches store precision 0.30–0.38 where the current formula yields 0.00/1.00/0.00/0.00/1.00/0.00. |
| Planning | 2026-10-08 | spec approved by the user. Four decisions taken by the user: scope is the per-agent view + compare modal (the all-agents index deferred); it extends the existing Evals tab rather than adding a page, so `client/src/vendor/ui/nav.ts` is untouched; "Promote" restores a version's `config_json` as a new version, behind a confirmation; the alert threshold is a fixed `-0.02`; and the per-row drill-down into batch case detail was ADDED, overturning `spec-creator`'s own weakest default. Three `spec-creator` rounds. Round 2 corrected two of my briefed assumptions against the code: `LineChart` cannot render a null gap (`data: number[]`, `?? 0`) and is unfixable here because `vendor/ui` is a repo-rule CRITICAL, so null handling moved into the caller (AC-66, AC-67); and `toDiffRows` already exists in `SkillDetail/VersionsTab`, so the prompt diff is a second-consumer promotion (AC-68), not a new implementation. Round 3 added AC-81 after `spec-creator` noticed the drill-down falsified its own earlier `## Untrusted inputs` claim — `eval_runs.actual_output` is model-authored and reaches the client again. 81 criteria, `check-specs.sh` green. |
| Implementation | 2026-10-08 | Multi-agent, per the plan's five-wave decomposition. Wave 1 contracts (both `vendor/shared` copies) → waves 2a (server S3–S15) and 2b (client S16–S24) in parallel on disjoint file sets. Two implementer deviations were correct and kept: `EvalBatchRecord` reordered above the trend/dashboard section (a forward `const` reference is a TDZ `ReferenceError`, not a style point), and `AgentVersionConfig` mirrored into the client's `knowledge.ts`, which had never carried it — first defined locally in `eval-ci.ts`, then moved on review so the two vendored trees stay structurally parallel. `EvalsTab` gained an `agentVersion` prop threaded from `AgentEditor` rather than a fifth query, keeping the paint budget at four. Wave 2b also found the pre-existing `VersionsTab` comment about `diffLines` trailing newlines to be false, and pinned the real behaviour rather than changing the helper under cover of a move. |
| Validation | 2026-10-08 | `plan-verifier` clean on the first pass (144/144 items, 0 Missing, 0 Contradicted, 0 unplanned hunks), `architecture-reviewer` 0 violations — it confirmed the container-getter is two one-directional chains rather than a cycle, and that the new `helpers.ts` functions are genuinely pure, which the filename-matching arch rule cannot check. **Four defects surfaced after that clean gate, none of them by a failing test.** (1) AC-24 made comparability turn on equality of `metrics_version`, so two batches both stamped `1` compared as if they shared a formula — caught against live data, where seven old-rollup batches and one current-formula batch all read `1`. (2) `spec-creator`, fixing that, found the identical defect in AC-13/AC-14 — the dashboard delta and trend, which mislead with no interaction at all. (3) `test-writer` found AC-77 unimplemented: `CaseDetailDialog` never read `error` and always rendered a static string, and the first `plan-verifier` had marked it **Met** because the existing test asserted that static string. (4) The delta `plan-verifier` then found AC-90's client half missing — the server emits two `incomparable_reason` codes and the client map resolved one, so the legacy case fell into the generic bucket. Defects 3 and 4 are the same shape: a criterion naming specific user-visible content, satisfied by a generic fallback, with a green test on top. Final: server typecheck · lint · `pnpm arch` clean, 657 unit tests; client typecheck · lint clean, 477 tests; `reviewer-core` 87; `check-specs.sh` green at 90 criteria; `client/src/vendor/ui/` absent from the diff. **Integration lane run at the user's request.** Run 1 was not a pass — `1 failed | 29 passed | 2 skipped`, exit code `0`: `agent-promote.it.test.ts` posted to `/versions/0/promote`, and `VersionParams.version` is `z.coerce.number().int().positive()`, so the route rejected it with 422 before the service saw it. The fixture had built a state that cannot occur — `agents.version` defaults to 1, so no version-0 snapshot exists. Route correct, fixture wrong; both agents in that block moved to version 2 with snapshots at 1, and the file then passed 6/6. Across runs 2 and 3 no test failed, and all four 0020 files executed and passed: `eval-metrics-version` 4, `eval-dashboard` 3, `eval-compare` 9, `agent-promote` 6 — 22 assertions against Postgres, closing the 17 criteria the first `plan-verifier` had marked Unverifiable, including AC-87/AC-88 and the promote transaction's link-before-snapshot ordering. No single run was clean by the green-run rule: skipped files went 2 → 1 → 8 across three consecutive lanes (31 tests skipped by the third), all of them pre-existing files guarded by `hasDocker ? describe : describe.skip` and none touched by this change. That degradation is the contention the lane's user-only rule exists for, measured. e2e and the two manual walks remain outstanding. |
| Completion | | status done, docs, insights wrap-up |
