---
title: Multi-Agent Review — parallel fan-out, grouped findings, "where agents disagree"
status: done
packages: [server, client]
---

> The lesson brief calls this spec `specs/multi-agent-review.md`; it is numbered `0021` so
> `scripts/check-specs.sh` and the index find it. This is **worktree A** of a two-worktree pair;
> worktree B is Export to CI (`feat/export-to-ci`).

## Problem & why

A PR mixes concerns (security, performance, conventions), and DevDigest reviews it with one agent or
with "run all", which runs the agents **one after another**. Concretely, today:

- `POST /pulls/:id/review` accepts only `{agentId?, all?}` (`server/src/vendor/shared/contracts/platform.ts:307-310`,
  `server/src/modules/reviews/service.ts:64-75`) — no way to run a chosen *subset*.
- The executor prepares diff and intent once (`server/src/modules/reviews/run-executor.ts:104-128`)
  but awaits each agent in turn (`run-executor.ts:130-159`), so wall-clock is the **sum** of agent
  times.
- `multi_agent_runs` exists (`server/src/db/schema/runs.ts:96-105`) and nothing reads or writes it;
  `agent_runs` has no column pointing at it, so N runs from one request cannot be recalled as a unit.
- `MultiAgentRun`, `AgentColumn`, `Conflict`, `ConflictTake`
  (`server/src/vendor/shared/contracts/observability.ts:22-86`) are defined and consumed by nothing.
- No pre-run time/cost estimate exists anywhere in the product.

The cost: a user running three agents reads three copies of the same obvious finding, cannot see
where agents genuinely disagree, waits for the sum of three runs, and does not know the cost
beforehand.

## Goals / Non-goals

**Goals**

- Pick N agents on the PR page or on a Configure run page, see an estimate from past runs, and
  launch them as **one** multi-agent run.
- Run the selected agents **in parallel**, isolated: one failure or cancel does not affect others.
- Record the fan-out as one `multi_agent_runs` parent with its `agent_runs` children.
- A results page with two layouts (Columns, Tabs + detail) over one resource, live per-agent status,
  and "View trace" through the existing trace drawer.
- A "Where agents disagree" block: findings grouped deterministically by code location, each agent's
  take including "did not flag", a "Show only conflicts" toggle, and every original finding still
  visible and actionable with its author.
- Simplicity: the brief asks for the simplest implementation that meets the above.

**Non-goals** — named because a reader would reasonably assume them:

- **Text-similarity, semantic or embedding grouping.** The brief mentions "similarity of essence";
  this spec groups by file and line range only. Two different issues on the same lines share a group;
  both stay visible with their authors.
- **A Learn or Reply-to-author backend.** Both buttons render disabled.
- **Persisting the agent selection** between visits.
- **A multi-run-level SSE stream.** Live status uses per-run `GET /runs/:id/events` plus refetching.
- **Worktree-per-agent execution.** The mockup says "fan-out via worktrees"; agents run as parallel
  promises in one process and the UI says "parallel".
- **A separate trigger route.** `POST /pulls/:id/review` is extended; the stale
  `POST /pulls/:id/multi-agent-run` mention in the comment at `observability.ts:9` is corrected.
- **A cancel control on the multi-agent page.** It shows status only; cancel stays where it is.
- **Changing single-`agentId` semantics.** The new `enabled` check applies to `agent_ids` only.
- Agent Performance / per-agent stats pages, Compose review, anything in Export to CI, and any change
  to the reviewer-core grounding gate or untrusted-input handling.

## Decisions

| Question | Decision | Consequence |
|---|---|---|
| How is a multi-agent run triggered? | Extend `POST /pulls/:id/review` with `agent_ids: string[]` (1–10, unique; each must exist in the workspace and be enabled, else 400). Sending more than one of `agentId` / `all` / `agent_ids` → 400. ≥2 resolved targets (incl. `all: true`) create one `multi_agent_runs` row and stamp `agent_runs.multi_run_id`; response gains `multi_run_id` (null for single-agent). | `RunRequest` and `ReviewRunResponse` change; migration `0025`. |
| Is `enabled` checked for a single `agentId`? | No — only for `agent_ids`. Existing `agentId` behaviour is unchanged. | A disabled agent can still be run alone, as today. |
| Read routes | `GET /multi-agent/:multiRunId` (workspace-scoped; payload carries `pr_id`, `pr_number`) backs the results page. One route, `GET /multi-agent/latest[?pr_id=]`, returns `{ run: {id, pr_id, pr_number, ran_at} | null }`: with `pr_id` it feeds the PR page's "Multi-Agent Review" link, without it the nav landing (amended 2026-10-15, plan P1/Q1: both callers need only the id). No `GET /pulls/:id/multi-agent?multiRunId=`. | Results URL stays `/multi-agent-review/<multiRunId>`. |
| Nav landing | `/multi-agent-review` opens the latest run if there is one, else Configure run; `?new=1` forces Configure run. Nav item lives in a new GLOBAL section, as in the mockup. | `client/src/vendor/ui/nav.ts` changes (allowed exception). |
| Execution | Diff + intent prepared once (already true); agents run with `Promise.allSettled`; failure/cancel isolated per agent. | Wall-clock ≈ slowest agent; up to 10 concurrent LLM calls per request. |
| Empty diff | Keep current behaviour: `loadDiff` returns an empty diff without throwing (`diff-loader.ts:19-29`); every agent runs and ends `done` with 0 findings. `failAll` only when the diff load throws. | No new guard; single-agent behaviour unchanged. |
| Grouping rule | Pure, deterministic: same file AND ranges overlapping with ±2-line tolerance AND lengths within 3× of each other, transitive (union-find). No text similarity. All original finding ids kept with attribution. | Unrelated issues on adjacent lines may share a group; nothing is hidden. |
| Takes | Only `done` agents get a take; an agent with no finding in the group = "did not flag" (`ignored`). Non-`done` agents are omitted from the group row. `divergent` = the flagging takes' severities are not all equal ("did not flag" alone is not a conflict). | A failed agent never reads as "did not flag". |
| Title / verdict / note | Group title = title of the highest-severity finding (tie → lowest `start_line`, then id). Flagged take verdict = its highest severity; note = that finding's title. Did-not-flag note is empty; UI shows "did not flag". | No LLM-written notes. |
| Totals and estimates | Wall-clock = max of agent durations; cost = null-safe sum. Estimates = per-agent avg duration/cost of past `done` runs on `GET /agents` (`est_duration_ms`, `est_cost_usd`, nullable). Agents without history show "no history" and are excluded; the summary is hidden when no selected agent has history. Card teaser = `agents.description`. | No estimate endpoint; the client computes the summary. |
| Configure run with 1 agent | The run button requires ≥2 checked agents. The PR-page picker keeps 1 agent = normal single run. | No null-`multi_run_id` navigation case. |
| Learn / Reply to author | Rendered disabled with a "coming soon" tooltip. Accept, Dismiss, Turn into eval case reuse `FindingCard` behaviour. | No new finding-action routes. |
| Live status and trace | Per-run SSE `GET /runs/:id/events` + refetch while any agent is running. "View trace" opens the existing `RunTraceDrawer`, moved to a shared location. | One drawer, two routes. |
| Deleted agent | `AgentColumn.agent_id` becomes nullable (`agent_runs.agent_id` is `on delete set null`, `runs.ts:17`); UI shows "Unknown agent". | Contract change in both vendored copies. |

## Ownership, shared contracts, merge order

**Worktree A (this spec, branch `feat/multi-agent-review`) owns:**

- The PR page header picker (replacing `RunReviewDropdown` in `PrDetailHeader`) and the PR-page
  "Multi-Agent Review" link.
- `client/src/app/multi-agent-review/**`.
- Moving `RunTraceDrawer` from `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/`
  to `client/src/components/run-trace-drawer/` (with an `index.ts` barrel).
- `server/src/modules/reviews/**` multi-run additions (service, executor, grouping, read routes) and
  the `agents` module estimate query.
- Schema `agent_runs.multi_run_id` in `server/src/db/schema/runs.ts`; migration `0025` (generated).
- Contracts, server canonical **and** client vendored mirror: `contracts/observability.ts`,
  `contracts/review-api.ts`, the `RunRequest` addition in `contracts/platform.ts`, the `Agent`
  estimate fields in `contracts/knowledge.ts`.

**Worktree A must not touch** (worktree B, Export to CI): `server/src/modules/ci/**`,
`agent-runner/**`, the CI Runs page, the agent CI tab, `contracts/eval-ci.ts`.

**Shared:**

- `client/src/vendor/ui/nav.ts` — A adds the GLOBAL section and its Multi-Agent Review item and
  merges first; B rebases and adds its own item. After A merges, the nav is re-checked separately.
- Finding attribution (agent / run per finding) is read by B's ingest. A adds
  `agent_runs.multi_run_id` and changes no type, nullability or meaning of any existing `agent_runs`
  or `findings` column.

**Merge order:** `chore/agent-runner` → `feat/multi-agent-review` (A) → `feat/export-to-ci` (B).

**Verification commands:**

| Scope | Command | Who runs it |
|---|---|---|
| server | `cd server && pnpm typecheck && pnpm lint && pnpm exec vitest run --exclude '**/*.it.test.ts'` | agents |
| client | `cd client && pnpm typecheck && pnpm lint && pnpm test` | agents |
| spec | `bash scripts/check-specs.sh` | session |
| server integration | `cd server && pnpm exec vitest run .it.test` | **user** |
| e2e | `./scripts/e2e.sh` | **user** |
| pre-push | `/pr-self-review` | **user** |

## User stories

- As a reviewer on a PR page, I want to tick several agents and run them in one go, so that I get
  every specialist's view without choosing one focus up front.
- As a reviewer, I want a Configure run page with a PR picker, agent cards and a time/cost estimate,
  so that I know what a fan-out will cost before I start it.
- As a reviewer watching a run, I want each agent's live status and a link to its trace, so that I
  can see who finished, who is still running, who failed, and why.
- As a reviewer reading results, I want overlapping findings grouped by code location with each
  agent's take — including "did not flag" — so that I read duplicates once and spot real
  disagreement, while every original finding stays visible and actionable.
- As the lesson author, I want a measured 1-agent vs 3-agent comparison on the same PR, so that the
  parallel fan-out claim rests on numbers rather than an expected 3×.

## Acceptance criteria (EARS)

**Trigger — `POST /pulls/:id/review`**

- AC-1: WHEN `POST /pulls/:id/review` receives `agent_ids` holding 1–10 unique ids that all exist in
  the caller's workspace and are enabled, the API shall create exactly one `agent_runs` row per id
  and return one `runs[]` entry per id.
- AC-2: IF `agent_ids` is empty, has more than 10 entries, contains a duplicate, names an agent that
  does not exist, belongs to another workspace or is disabled, or the body sets more than one of
  `agentId` / `all` / `agent_ids`, THEN the API shall respond 400 and create no `agent_runs` or
  `multi_agent_runs` row.
- AC-3: WHEN the resolved targets number two or more (via `agent_ids` or `all: true`), the API shall
  create exactly one `multi_agent_runs` row for the PR, set `multi_run_id` on every `agent_runs` row
  of that request to its id, and return that id as `multi_run_id`.
- AC-4: WHEN the resolved targets number exactly one, the API shall return `multi_run_id: null`,
  create no `multi_agent_runs` row, and leave the run's `multi_run_id` NULL.
- AC-5: The API shall keep the existing `{agentId}` and `{all: true}` bodies' behaviour unchanged —
  including running a disabled agent given by `agentId` — so that every pre-existing review-route
  test passes unmodified.

**Execution — run executor**

- AC-6: WHEN a request resolves to N ≥ 2 agents, the run executor shall load the diff and derive
  intent exactly once, then run every agent through the same per-agent path a single run uses
  (`runOneAgent`), adding no new prompt-building path.
- AC-7: WHEN a request resolves to N ≥ 2 agents, the run executor shall start all N agent runs
  before any of them completes.
- AC-8: IF one agent's run throws or is cancelled, THEN the run executor shall still bring every
  other agent run of the request to its own terminal status.
- AC-9: IF loading the diff throws, THEN the run executor shall mark every run of the request
  `failed` with the diff-load error (existing `failAll`, `run-executor.ts:84-112`).
- AC-10: WHEN the diff loads with zero files, the run executor shall run every agent and not call
  `failAll`, so each run ends `done` with 0 findings.

**Schema**

- AC-11: The schema shall add `agent_runs.multi_run_id` (nullable uuid → `multi_agent_runs.id`,
  `on delete set null`, indexed) via a drizzle-kit generated migration `0025` that contains only
  additive statements, with no existing migration file changed.

**Read routes**

- AC-12: WHEN `GET /multi-agent/:multiRunId` names a multi-agent run in the caller's workspace, the
  API shall return its `MultiAgentRun` including `pr_id` and `pr_number`; otherwise it shall respond
  404.
- AC-13: WHEN `GET /multi-agent/latest` is called, the API shall return 200 with
  `{ run: {id, pr_id, pr_number, ran_at} }` for the workspace's multi-agent run with the latest
  `ran_at` — restricted to that PR when `?pr_id=` is given — or `{ run: null }` when there is none.
- AC-14: The API shall return one `AgentColumn` per `agent_runs` row whose `multi_run_id` is the run,
  with `status` in `running | done | failed | cancelled`, findings as full `FindingRecord`s
  (`confidence`, `rationale`, `suggestion`, `start_line`, `end_line`, `accepted_at`,
  `dismissed_at`), and `agent_id: null` when the agent has been deleted.
- AC-15: The API shall return `cost_usd` and `total_cost_usd` as JSON numbers or `null` (never
  strings), `total_duration_ms` as the maximum non-null column duration (0 when none), and
  `total_cost_usd` as the sum of non-null column costs (`null` when all are null).

**Grouping — pure function over the persisted findings of one multi-agent run**

- AC-16: The grouping function shall put two findings in one group exactly when they share `file`
  and their ranges `[start_line − 2, end_line + 2]` overlap and neither range (`end − start + 1`) is
  more than 3× the other's length, transitively (A~B and B~C → one group), so that a file-wide finding
  does not absorb the narrow findings inside it, and so that findings in different files, or with identical titles but non-overlapping ranges, stay in
  separate groups.
- AC-17: The grouping function shall emit every input finding id exactly once across all groups,
  under the take of the agent run that produced it (`ConflictTake.finding_ids`).
- AC-18: The grouping function shall emit exactly one take per `done` column in every group — verdict
  `ignored` and `finding_ids: []` for a `done` agent with no finding in the group — and no take for
  a `running`, `failed` or `cancelled` column.
- AC-19: The grouping function shall set a flagged take's verdict to the highest severity among that
  agent's findings in the group (`CRITICAL` > `WARNING` > `SUGGESTION`) and its note to that
  finding's title, an `ignored` take's note to `""`, and the group title to the title of the
  highest-severity finding in the group (tie: lowest `start_line`, then id).
- AC-20: The grouping function shall set `divergent: true` on a group exactly when the verdicts of
  its non-`ignored` takes are not all equal, so that "did not flag" alone is not a conflict.
- AC-21: The grouping function shall return identical output for any permutation of its input, with
  groups ordered by `file` then first line.
- AC-22: The grouping function shall treat a finding whose `end_line` is null or less than
  `start_line` as `[start_line, start_line]`, and iterate over findings rather than line numbers, so
  that 500 findings including `start_line = 2147483647` group within 100 ms in a unit test.

**Estimates — `GET /agents`**

- AC-23: The API shall return on every agent from `GET /agents` `est_duration_ms` and `est_cost_usd`
  as numbers averaged over that agent's `done` runs only, or `null` when it has no `done` run.

**PR page**

- AC-24: The PR detail header shall render an agent picker in place of `RunReviewDropdown`, listing
  every enabled agent with a checkbox and `~Ns` from `est_duration_ms` or "no history", a Clear
  control that unchecks all, a "Select all" control that checks every listed agent, and a
  "Configure agents…" link to `/multi-agent-review?new=1&pr=<prId>`.
- AC-25: The agent picker shall render its "Run multi-agent review (N)" button disabled while no
  agent is checked, with N equal to the number of checked agents.
- AC-26: WHEN the user runs the picker, the client shall send `agent_ids` with exactly the checked
  ids, then stay on the PR page with today's single-run behaviour if one was checked, or navigate to
  `/multi-agent-review/<multi_run_id>` if two or more were.
- AC-27: WHERE `GET /multi-agent/latest?pr_id=<prId>` returns a run, the PR page shall render a
  "Multi-Agent Review" link to `/multi-agent-review/<id>`, and render no such link when it returns
  `{ run: null }`.

**Navigation and Configure run — `/multi-agent-review`**

- AC-28: The sidebar nav shall contain a GLOBAL section with a "Multi-Agent Review" item linking to
  `/multi-agent-review`, marked active on that path and every path beneath it.
- AC-29: WHEN `/multi-agent-review` is opened without `?new=1` and `GET /multi-agent/latest` returns
  a run, the client shall navigate to `/multi-agent-review/<id>`; otherwise it shall render
  Configure run.
- AC-30: WHILE no pull request is selected, the Configure run page shall show the "Pick a pull
  request first" empty state in place of the agent cards; WHEN opened with `?pr=<prId>`, it shall
  preselect that PR.
- AC-31: WHEN a pull request is selected, the Configure run page shall render one card per enabled
  agent with its name, its `description`, and "duration · cost" from its estimates or "no history",
  plus a Select all control that checks every card.
- AC-32: WHILE fewer than two agents are checked, the Configure run page shall render the run button
  disabled.
- AC-33: WHILE at least one checked agent has estimates, the Configure run page shall show
  "≈ <max est_duration_ms> · <sum est_cost_usd> · parallel fan-out" computed over checked agents
  with estimates only, and show no summary when none has estimates.
- AC-34: WHEN the user runs from Configure run, the client shall send `agent_ids` with exactly the
  checked ids and navigate to `/multi-agent-review/<multi_run_id>`.

**Results page — `/multi-agent-review/<multiRunId>`**

- AC-35: The results page header shall show the PR number and title, "N selected agents · parallel",
  `total_duration_ms`, `total_cost_usd`, and a "Configure run" link to
  `/multi-agent-review?new=1&pr=<prId>`, and shall never render the word "worktrees".
- AC-36: The Columns view shall render one column per `AgentColumn` with the agent name ("Unknown
  agent" when `agent_id` is null), status, score ring, duration, cost, one row per finding (severity,
  title, `file:line`), the findings count, "View trace", the run's `error` text when `failed`, and a
  "cancelled" label when `cancelled`.
- AC-37: WHILE any column is `running`, the results page shall refetch the run at most every 3 s and
  subscribe to `GET /runs/:id/events` for each running run, and stop refetching once no column is
  `running`.
- AC-38: WHEN the user clicks "View trace" in a column or tab, the results page shall set
  `?trace=<run_id>` and open the `RunTraceDrawer` from `client/src/components/run-trace-drawer/` —
  the only `RunTraceDrawer` implementation in the client — with `running` true while that column is
  `running`.
- AC-39: WHEN the user toggles to Tabs, the results page shall render, without issuing any
  `POST /pulls/:id/review`, one tab per column labelled with agent name and score, and for the
  selected tab a summary card (summary, duration, cost, "View trace") above that agent's findings
  rendered with the existing `FindingCard` (confidence, rationale, suggested fix).
- AC-40: The results page shall wire Accept, Dismiss and Turn into eval case to the same endpoints
  the PR page's `FindingCard` calls today, and render Learn and Reply to author disabled with a
  "coming soon" tooltip so that clicking either issues no network request.
- AC-41: The disagree block shall render in both views one row per group with `file:start_line`
  (`–end_line` when different), the group title, and one cell per take (agent name, severity or
  "did not flag", note); WHILE "Show only conflicts" is on it shall render only `divergent` groups;
  WHEN a group is expanded it shall list each of its findings as a `FindingCard` labelled with its
  agent.

**Untrusted model output, boundaries, measurement**

- AC-42: The results page shall render finding titles, rationales, suggestions, notes, summaries and
  file paths as text, so that a title `<img src=x onerror=alert(1)>` renders literally and creates
  no `img` element.
- AC-43: The `feat/multi-agent-review` diff against `origin/main` shall change no path under
  `server/src/modules/ci/`, `agent-runner/`, the CI Runs page, the agent CI tab, or
  `contracts/eval-ci.ts`.
- AC-44: Before this spec moves to `done`, `## Measurement results` and the PR description shall
  both record, for one single-agent run and one three-agent run on the same PR: tokens in/out per
  agent, request wall-clock, per-agent duration, total cost, and group / divergent-group counts — as
  measured, with the observed ratio stated without adjustment toward 3×.

## Edge cases

| Case | Handling | AC |
|---|---|---|
| 0 agents checked | Picker and Configure run buttons disabled | AC-25, AC-32 |
| 1 agent in PR picker | Normal single run, no parent | AC-4, AC-26 |
| 1 agent on Configure run | Button disabled (needs ≥2) | AC-32 |
| Agent deleted or disabled between pick and run | 400, nothing created | AC-2 |
| Agent deleted after the run | Column kept, "Unknown agent" | AC-14, AC-36 |
| `agentId` + `agent_ids` in one body | 400 | AC-2 |
| Every agent fails | Every column `failed` with error; no takes, so no groups | AC-8, AC-18, AC-36 |
| Diff load throws | Every run `failed` via `failAll` | AC-9 |
| PR with an empty diff | Agents run, columns `done`, 0 findings, empty disagree block | AC-10 |
| One agent cancelled mid-run (via existing cancel) | Others continue; column shows "cancelled", omitted from takes | AC-8, AC-18, AC-36 |
| Same PR reviewed again | Latest reachable from PR page and nav; older by `/multi-agent-review/<id>` | AC-12, AC-13 |
| Agent with zero findings | "did not flag" in every group | AC-18 |
| Null / inverted / huge line numbers (model-controlled) | Clamped; grouping bounded by finding count | AC-22 |
| Same issue at ±1–2 lines across agents | Grouped by tolerance | AC-16 |
| Different issues on overlapping lines | One group; each finding visible with its author | AC-17, AC-41 |
| More than 10 agents | 400 | AC-2 |
| No checked agent has history | "no history" on cards; summary hidden | AC-31, AC-33 |
| SSE drops or server restarts mid-run | Refetch still updates status; orphaned runs reaped on boot (`service.ts:110-113`) | AC-37 |

## Mockups — what they leave open, and how this spec resolves it

- `multi_agents_4.PNG` shows **Architecture** in the disagree block of a 4-agent run that did not
  select it → resolved by AC-18: takes come only from `done` columns of the run.
- In the same mockup **Security** flags `src/middleware/ratelimit.ts:52` in its column, yet reads
  "did not flag" at `ratelimit.ts:52` in the disagree block → resolved by AC-16/AC-18: a finding in a
  group's range makes its agent a flagged take there.
- The group title "Magic number 3600" matches no finding title, and "did not flag" cells carry
  notes no data source produces → resolved by AC-19 (title of the highest-severity finding; empty
  note for did-not-flag).
- "fan-out via worktrees" → the UI says "parallel" (AC-35).
- Configure run card teasers read like last-run summaries → `agents.description` (AC-31).
- No cancel control is drawn → none is added; status only (AC-36).

## Non-functional

- **Grouping cost:** 500 findings group in ≤ 100 ms (AC-22); O(F log F) in findings, never in line
  values.
- **Request bound:** ≤ 10 agents per request (AC-2); the route's existing 10 requests/minute rate
  limit (`server/src/modules/reviews/routes.ts:46`) is unchanged.
- **Live status latency:** a persisted status change appears within 3 s (AC-37).
- **Accessibility:** WCAG 2.1 AA for the new controls — agent checkboxes, Select all / Clear, the
  Columns/Tabs toggle, the agent tabs and "Show only conflicts" are keyboard-operable with
  accessible names; status and severity always carry a text label, not colour alone.
- **i18n:** user-facing strings live in `client/messages/en/multiAgentReview.json` (camelCase keys);
  mockup copy is a draft.
- **Enforcement coverage:** 41 of 44 criteria have an automated test planned below. AC-11 and AC-43
  are mechanical checks on the diff. AC-44 is confirmed only by the manual run; nothing automated
  stops this spec reaching `done` without the measurement.

## Inputs (provenance)

| Input | Source | Provenance | Notes |
|---|---|---|---|
| PR diff and intent | `loadDiff`, `deriveIntent` (`run-executor.ts:104-128`) | [reused: spec 0008] | Prepared once per request |
| Per-agent findings, score, summary | reviewer-core via `runOneAgent` | [llm] | Grounded by `groundFindings()` before persistence |
| Run status, duration, tokens, cost, error | `agent_runs` | [reused: spec 0001] | `cost_usd` is `numeric` → string in Drizzle; converted to number |
| Live run events | `GET /runs/:id/events`, `useRunEvents(runIds)` | [reused: spec 0009] | Per-run, in-memory replay buffer |
| Run trace | `GET /runs/:id/trace`, `RunTraceDrawer` | [reused: spec 0009] | Drawer moved, not rewritten |
| Finding actions | `FindingCard`, `useFindingAction`, `useCreateEvalCase` | [reused: spec 0019] | Accept, Dismiss, Turn into eval case |
| `multi_agent_runs` parent, `agent_runs.multi_run_id` | this feature | [new] | |
| Groups, takes, `divergent`, group title, notes | grouping function | [deterministic: union-find over file + `[start−2, end+2]` overlap + 3× length ratio; severity ordering] | Computed on read, not stored |
| Totals | read service | [deterministic: max of durations, null-safe sum of costs] | |
| `est_duration_ms`, `est_cost_usd` | `GET /agents` | [deterministic: SQL average over `done` runs] | |
| Pre-run summary | client | [deterministic: max / sum over checked agents with estimates] | |
| Card teaser | `agents.description` | [reused] | User-written, not model output |
| Measurement numbers | manual run on the dev app | [new] | Recorded as measured |

## Untrusted inputs

- **PR diff, title, body** — written by the PR author. They reach a prompt only through the existing
  per-agent path, which wraps them with `wrapUntrusted()` and grounds findings with
  `groundFindings()` (`reviewer-core/AGENTS.md`). This feature adds no prompt path (AC-6); fan-out
  multiplies exposure, not paths.
- **Model output** — finding titles, rationales, suggestions, summaries, file paths, line numbers.
  Generated from attacker-influenceable text, so: rendered as text, never HTML (AC-42); line numbers
  not trusted to be present, ordered or small — clamped, and grouping is bounded by finding count
  (AC-22); never fed back into a prompt by this feature. Group titles and notes are copied from
  finding titles and inherit the same rendering rule.
- **`agent_ids`, `:multiRunId`** — client-supplied; `agent_ids` validated for count, uniqueness,
  existence, workspace and enabled state before anything is created (AC-2); `:multiRunId` scoped to
  the caller's workspace (AC-12).

## Test plan

| Criteria | Test |
|---|---|
| AC-1, AC-2, AC-3, AC-4, AC-5 | `server/test/reviews-multi-trigger.test.ts` (stubbed repos): valid 2-id set creates 2 runs + one parent with both stamped and `multi_run_id` returned; `all: true` with 3 enabled agents creates a parent; empty / 11 ids / duplicate / unknown / foreign-workspace / disabled id / `agentId`+`agent_ids` → 400 with zero creates; 1 id → `multi_run_id: null`, no parent; existing route tests pass unmodified and a disabled agent via `agentId` still runs |
| AC-6, AC-7, AC-8, AC-9, AC-10 | `server/test/reviews-fanout.test.ts`: `loadDiff` and `deriveIntent` called once for 3 agents, `runOneAgent` once per agent; with deferred stubs all 3 start before any resolves; one stub throws and one is cancelled, the third reaches `done`; `loadDiff` throws → all `failed` with its message; zero-file diff → `failAll` not called, all `done` |
| AC-11 | Read `server/src/db/migrations/0025_*.sql`: only `ADD COLUMN` / `ADD CONSTRAINT` / `CREATE INDEX`; `git diff --name-only origin/main -- server/src/db/migrations` lists only the new `0025` file and `meta/` additions |
| AC-12, AC-13, AC-14, AC-23 | `server/test/multi-agent.it.test.ts` (**user-run**): run in workspace → 200 with `pr_id`/`pr_number`; foreign workspace / unknown id → 404; two runs on one PR → `latest?pr_id=` returns the newer, `latest` returns newest across PRs; empty → 200 `null`; a single run on the same PR is not a column; `cancelled` surfaces; findings carry `confidence`/`suggestion`; deleted agent → `agent_id: null`; agent with done runs 1000/3000 ms and $0.01/$0.03 → 2000 and 0.02 as numbers, agent with only failed/cancelled/running runs → both null |
| AC-15 | `server/test/multi-agent-read.test.ts`: costs are `number`; max of `[1200, null, 800]` = 1200, all null → 0; sum of `[0.01, null, 0.02]` = 0.03, all null → `null` |
| AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22 | `server/test/multi-agent-grouping.test.ts`: lines 10 and 12 group, 10 and 14 group by tolerance, 10 and 20 do not; 9–64 does not absorb 59–63 / 61–63 while 18–49 joins it; 3× lengths group, just over 3× do not; A–B–C chain is one group; same lines in two files → two groups; identical titles, disjoint ranges → two groups; every id exactly once under its run; 3 done + 1 failed column → 3 takes, `ignored` + `[]` for the silent one; WARNING+SUGGESTION from one agent → WARNING with that title as note, ignored note `""`, group title from the highest severity with tie on `start_line`; all-equal → `divergent: false`, mixed severities → true, one flag + did-not-flag → false; shuffled input deep-equals; `end_line` null / below start clamps; 500 findings incl. 2147483647 < 100 ms |
| AC-24, AC-25, AC-26 | `client/src/app/repos/[repoId]/pulls/[number]/_components/AgentPicker/AgentPicker.test.tsx`: enabled agents with `~Ns` / "no history"; Clear unchecks; Configure link href; disabled at 0, label N at 2; one checked posts `[id]` and does not navigate; two checked posts both and navigates |
| AC-27 | `PrDetailHeader` test: link present with the run id when the latest route returns a run, absent on `null` |
| AC-28, AC-29 | Nav test in `client/src/components/app-shell`: GLOBAL section item, active on `/multi-agent-review/abc`; `client/src/app/multi-agent-review/page.test.tsx`: latest exists → navigates; `null` → Configure run; `?new=1` → Configure run even when latest exists |
| AC-30, AC-31, AC-32, AC-33, AC-34 | `client/src/app/multi-agent-review/_components/ConfigureRun/ConfigureRun.test.tsx` + `client/src/lib/utils/multiAgentEstimate.test.ts`: empty state with no PR; `?pr=` preselects; cards show description and estimate or "no history"; Select all; button disabled at 0 and 1, enabled at 2; summary = max/sum over agents with history, an agent without history changes neither, no summary when none has history; run posts checked ids and navigates |
| AC-35, AC-36, AC-37, AC-38, AC-39, AC-40 | `client/src/app/multi-agent-review/_components/ResultsView/ResultsView.test.tsx` and `TabsView/TabsView.test.tsx`: header strings, no "worktrees"; one column per agent with score, duration, cost, rows, count; failed shows error, cancelled shows label, null agent → "Unknown agent"; fake timers: refetch within 3 s while running, none once done, `useRunEvents` gets running ids only; View trace sets `?trace=` and mounts the shared drawer with `running`; a search for `RunTraceDrawer.tsx` under `client/src` finds one file and its moved test passes; toggling issues no POST; tab per agent with score, summary card, `FindingCard`; Accept/Dismiss/Turn into eval case call existing hooks; Learn/Reply disabled with tooltip and fire no fetch |
| AC-41, AC-42 | `client/src/app/multi-agent-review/_components/DisagreeBlock/DisagreeBlock.test.tsx`: one row per group, cell per take, "did not flag"; toggle on hides a non-divergent group and keeps a divergent one, off shows both; expand lists findings with their agent; rendered in both views; a title `<img src=x onerror=alert(1)>` renders as text and `querySelector('img')` is null |
| AC-43 | `git diff --name-only origin/main...feat/multi-agent-review` contains no path under `server/src/modules/ci/`, `agent-runner/`, `contracts/eval-ci.ts`, the CI Runs page or the agent CI tab |
| AC-44 | Manual run on the dev app (`./scripts/dev.sh`, real `OPENROUTER_API_KEY`) on one demo PR: one agent, then three; numbers copied into `## Measurement results` and the PR description; checked by reading both |

## Measurement results

Measured 2026-10-15 on the local API from this branch (`./scripts/dev.sh --no-seed --no-client`), PR
`Pereplut/dev-digest#21` (+375 / −4, "bound and abort the OpenRouter call"), all agents on
`openrouter / deepseek/deepseek-v4-flash`. Wall-clock is the POST until every run is terminal (2 s poll),
from `measure.py` against `POST /pulls/:id/review`, `GET /pulls/:id/runs` and `GET /multi-agent/:id`.
Run A was a cold warm-up, so the fair single-agent baseline is C, run right after B.

| Run | Agents | Tokens in / out (per agent) | Wall-clock | Per-agent duration | Total cost | Groups / divergent |
|---|---|---|---|---|---|---|
| A — 1 agent (cold warm-up) | Security | 12,680 / 1,754 | 36.2 s | 35.0 s | $0.000727 | n/a (no multi-run, AC-4) |
| C — 1 agent (warm) | Security | 11,455 / 1,942 | 20.2 s | 19.3 s | $0.001359 | n/a (no multi-run, AC-4) |
| B — 3 agents | Security · Performance · General | 11,455 / 1,261 · 12,533 / 1,403 · 13,489 / 7,156 | 96.4 s | 34.6 s · 31.1 s · 95.3 s | $0.003895 | 1 / 1 |

**Observed ratios, B ÷ C (not adjusted toward 3×):** tokens in 3.27×, tokens out 5.06×, cost 2.87×,
wall-clock 4.77×.
- Wall-clock is the slowest agent, not the sum: B's 96.4 s is General's 95.3 s, which wrote 7,156 output
  tokens (3.7–5.7× the others). Security and Performance alone finished in ~31–35 s.
- Security took 34.6 s inside the fan-out against 19.3 s alone (1.8×), with identical input tokens —
  per-agent latency grows under parallel load on the same provider.
- Cost per token is not stable between calls: Security cost $0.000727 (A) and $0.001359 (C) for similar
  token counts, so a single run's cost is a noisy estimate.
- Diff and intent were prepared once for B (run-executor), so the fan-out did not multiply that work;
  input tokens per agent are ~11–13k because each agent's prompt carries the same diff.
- The one group: `server/src/adapters/llm/openrouter.ts:81-93`, General flagged CRITICAL
  ("Unhandled promise rejection from inner provider when timeout fires"), Security and Performance did not
  flag → divergent under the original rule (not divergent since the 2026-10-15 amendment below).
  Not verified here; it is a review finding on PR #21, not on this branch.

## Amendment 2026-10-15 — grouping and conflicts (after PR #26)
Found on the dev app with a 4-agent run on PR #6 (27 findings): all 9 groups were divergent, so "Show only
conflicts" hid nothing, and file-wide findings (`routes.ts:9-64`, "all routes lack auth") merged up to 9
unrelated findings into one group. AC-16 gained the 3× length ratio and AC-20 now ignores "did not flag".
Replayed on the same 27 findings: 17 groups, 5 divergent.

## Phases
| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-10-15 | mockups + brief read; 1 researcher (CI, handed off) + 2 Explore runs (upstream cf47df3, local state) before the spec |
| Planning | 2026-10-15 | spec-creator (first write blocked by spec-scope-gate on worktrees → fixed in PR #24); 44 ACs; approved by the user. implementation-planner → `0021-multi-agent-review.plan.md`; user then amended: one `latest` route (AC-13/27/29), "Select all" in the PR picker (AC-24), server tests in `server/test/` (plan D5), `FindingCard` imported in place, AC-44 1-agent group counts "n/a" |
| Implementation | 2026-10-15 | 2 sequential implementers: server S1–S11 (a537005; 702 unit tests, migration 0025 generated) and client S12–S22 (483fce7; 515 client tests). Spec in-progress |
| Validation | 2026-10-15 | plan-verifier clean (113 items, 0 Missing / 0 Contradicted); architecture-reviewer 0 CRITICAL, 2 WARNING — `FindingCard` cross-route import kept (user decision Q2), `columnMeta` lifted to `app/multi-agent-review/helpers.ts`; `pnpm arch` 0 errors in the worktree. user-owned lanes run afterwards — see Completion |
| Completion | 2026-10-15 | `/pr-self-review` PASS (21 reviewers, 2 rounds; 0 CRITICAL, 4 WARNING, 29 SUGGESTION); `.it.test` 181 passed; e2e 12/12; `next build` ok; migration 0025 applied on the dev DB; AC-44 measured (above); docs by doc-writer (`server/docs/multi-agent-review.md`, `client/docs/multi-agent-review-ui.md`, ADR `server/docs/adr/0001-group-findings-by-line-overlap.md`); insights wrap-up done. Status done. |
