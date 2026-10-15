# Development Plan — spec 0021 (Multi-Agent Review)

## Task
Extend `POST /pulls/:id/review` with `agent_ids`, record a fan-out as one `multi_agent_runs` parent with stamped `agent_runs` children, run the agents in parallel with `Promise.allSettled`, serve the run plus deterministic findings groups through three read routes, add per-agent estimates to `GET /agents`, and build the client side: the PR-page agent picker, `/multi-agent-review` (landing + Configure run), and `/multi-agent-review/<multiRunId>` (Columns/Tabs, disagree block, shared trace drawer). Work happens only in worktree `/home/komp/devdigest-review` (branch `feat/multi-agent-review`, base `origin/main` = `c70c0e4`).

## User decisions after planning (2026-10-15) — these OVERRIDE the text below
| Item | Decision | What changes in this plan |
|---|---|---|
| Q1 + P1 | **One latest route**: `GET /multi-agent/latest[?pr_id=<uuid>]` → `MultiAgentLatest` = `{ run: MultiAgentRunRef \| null }`. With `pr_id`: 404 for an unknown/foreign PR (via `getPull`), else that PR's newest run. Without: the workspace's newest run. | Drop `GET /pulls/:id/multi-agent/latest` from the hand-off route table, S10 and the `.it` test; query schema `{ pr_id: z.string().uuid().optional() }`. Client: `useLatestMultiAgentRun(prId?)` with key `["multi-agent-latest", prId ?? null]` replaces both `useLatestMultiAgentRun()` and `usePrLatestMultiAgentRun`; `useRunReview` invalidates the `["multi-agent-latest"]` prefix. Spec AC-13/27/29 amended to match. |
| Q2 | `FindingCard` is **imported in place** from the PR route's `_components`, with a one-line comment naming this decision. | As planned (P6 declined). |
| Q3 | AC-44: the 1-agent row records group/conflict counts as **"n/a"**. | As planned. |
| Q4 | Server tests live in **`server/test/`** with the D5 name mapping. | As planned; the spec's test plan now names these paths. |
| P4 | **Add "Select all"** to the PR-page `AgentPicker` next to Clear: it checks every listed (enabled) agent. | S14 gains the control; AC-24 amended; `AgentPicker.test.tsx` asserts Select all checks every agent and the button label becomes N. |
| P2, P3 | **Declined**: keep per-run SSE refetch on the results page (AC-37) and the Tabs view (AC-39). | None. |

## Requirements source
| Governing spec | `status:` (`path:line`) | Criteria it defines | Rows in my review |
|---|---|---|---|
| `/home/komp/devdigest-review/specs/0021-multi-agent-review.md` | `status: approved` (`specs/0021-multi-agent-review.md:3`) | 44 (AC-1 … AC-44) | 44 spec rows (R1–R44) + 3 user rows (R45–R47) = 47 |

The counts match: 44 criteria and 44 spec rows. The session relayed three user requirements that are not spec criteria: the fixed execution mode, simplicity / prefer cuts, and the AC-44 measurement procedure. They appear as R45–R47 and are sourced to the user (relayed). None of them is merged into the spec's criteria.

## Requirements review
| ID | Requirement, restated in one sentence | Source | Verdict | Satisfied by |
|---|---|---|---|---|
| R1 | A request with 1–10 distinct, existing, enabled, same-workspace `agent_ids` creates one run row and one `runs[]` entry per id | `specs/0021-multi-agent-review.md:140 (AC-1)` | clear | S1, S7, S8, S10, S11 |
| R2 | An empty, oversized, duplicated, unknown, foreign or disabled id list, or a body setting two of `agentId`/`all`/`agent_ids`, returns **400** and creates nothing | `:143 (AC-2)` | clear. One repo hazard: this API maps every `ZodError` to **422** (`server/src/app.ts:157-186`), so none of these checks may be a Zod refinement on `RunRequest`. Decision D1 puts them in the service | S1, S7, S8, S11 |
| R3 | When two or more targets resolve (including `all:true`), exactly one parent row exists, every child carries its id, and the response returns it | `:147 (AC-3)` | clear | S3, S5, S8, S10, S11 |
| R4 | One resolved target returns `multi_run_id: null`, creates no parent, and leaves the column NULL | `:150 (AC-4)` | clear | S8, S11 |
| R5 | `{agentId}` and `{all:true}` behave exactly as today, including a disabled agent run alone, and the old route tests pass unmodified | `:152 (AC-5)` | clear. The old route tests live in `server/test/reviews.it.test.ts`, so this is **user-verified** | S8, S11 |
| R6 | For two or more agents, diff and intent are prepared once and every agent goes through `runOneAgent`, with no new prompt path | `:158 (AC-6)` | clear | S9, S11 |
| R7 | All N agent runs start before any of them finishes | `:161 (AC-7)` | clear | S9, S11 |
| R8 | One agent throwing or being cancelled does not stop the others reaching their own terminal status | `:163 (AC-8)` | clear | S9, S11 |
| R9 | A diff-load throw marks every run `failed` through the existing `failAll` | `:165 (AC-9)` | clear (already true, `run-executor.ts:84-112`; pinned by a test) | S9, S11 |
| R10 | A zero-file diff runs every agent, never calls `failAll`, and ends each run `done` with 0 findings | `:167 (AC-10)` | clear | S9, S11 |
| R11 | `agent_runs.multi_run_id` is a nullable, indexed uuid FK with `on delete set null`, added by a generated, purely additive `0025` migration that edits no existing migration | `:172 (AC-11)` | clear (latest today is `0024_sad_morg.sql`) | S3, S4, V-table |
| R12 | `GET /multi-agent/:multiRunId` returns the workspace's run with `pr_id`/`pr_number`, else 404 | `:178 (AC-12)` | clear | S5, S8, S10, S11 |
| R13 | The two "latest" routes return the newest-`ran_at` run for the PR or the workspace, or 200 with `null` | `:181 (AC-13)` | **ambiguous**: it is unclear whether "the multi-agent run" means the full `MultiAgentRun` (columns, findings, groups) or a reference, and whether `null` is the bare body or a field. The only consumers need the id (`:69`) | **Q1** · S1, S5, S8, S10 (on the default) |
| R14 | One column per child run: status in `running/done/failed/cancelled`, full `FindingRecord` findings, `agent_id: null` for a deleted agent | `:184 (AC-14)` | clear | S1, S5, S7, S8, S11 |
| R15 | Costs are JSON numbers or null; total duration = max non-null (0 when none); total cost = null-safe sum (null when all null) | `:188 (AC-15)` | clear | S5, S7, S11 |
| R16 | Two findings share a group exactly when they share a file and their ±2-widened ranges overlap, transitively | `:194 (AC-16)` | clear (algorithm: D4) | S7, S11 |
| R17 | Every input finding id appears exactly once, under the take of the run that produced it | `:198 (AC-17)` | clear | S1, S7, S11 |
| R18 | Exactly one take per `done` column in each group (`ignored` + `[]` when silent), none for other statuses | `:200 (AC-18)` | clear | S7, S11 |
| R19 | A flagged take's verdict is its highest severity and its note that finding's title; an ignored note is `""`; the group title is the top-severity finding's (tie: lowest start, then id) | `:203 (AC-19)` | clear | S7, S11 |
| R20 | `divergent` is true exactly when the takes' verdicts are not all equal | `:207 (AC-20)` | clear | S1, S7, S11 |
| R21 | Output is identical for any permutation of the input; groups are ordered by file, then first line | `:209 (AC-21)` | clear. Take order is fixed inside the function (D4), otherwise permuting columns would change the output | S7, S11 |
| R22 | A null or inverted `end_line` clamps to `[start,start]`; work is bounded by finding count; 500 findings including `2147483647` group in under 100 ms | `:211 (AC-22)` | clear | S7, S11 |
| R23 | `GET /agents` gives every agent `est_duration_ms`/`est_cost_usd` averaged over `done` runs only, or null | `:217 (AC-23)` | clear | S1, S6, S11 |
| R24 | The PR header shows a picker instead of `RunReviewDropdown`: every enabled agent with a checkbox and `~Ns` or "no history", a Clear control, and a "Configure agents…" link to `/multi-agent-review?new=1&pr=<prId>` | `:222 (AC-24)` | clear | S15, S16, S21 |
| R25 | "Run multi-agent review (N)" is disabled at zero checked, and N counts the checked agents | `:225 (AC-25)` | clear | S15, S21 |
| R26 | Running the picker posts exactly the checked ids; one stays on the PR page with today's behaviour, two or more navigate to the results page | `:227 (AC-26)` | clear | S13, S15, S21 |
| R27 | The PR page shows a "Multi-Agent Review" link only when the PR-latest route returns a run | `:230 (AC-27)` | clear | S13, S16, S21 |
| R28 | The sidebar has a GLOBAL section whose item links to `/multi-agent-review` and is active on that path and below it | `:236 (AC-28)` | clear | S17, S21 |
| R29 | Without `?new=1`, the landing redirects to the workspace-latest run if one exists; otherwise it renders Configure run | `:238 (AC-29)` | clear | S18, S21 |
| R30 | With no PR selected, an empty state replaces the cards; `?pr=<prId>` preselects that PR | `:241 (AC-30)` | clear (picker scope: D8) | S18, S21 |
| R31 | With a PR selected: one card per enabled agent (name, description, "duration · cost" or "no history") and a Select all control | `:244 (AC-31)` | clear | S14, S18, S21 |
| R32 | The Configure run button is disabled below two checked agents | `:247 (AC-32)` | clear | S18, S21 |
| R33 | The summary is "≈ max duration · summed cost · parallel fan-out" over checked agents that have estimates, and is hidden when none has | `:249 (AC-33)` | clear | S14, S18, S21 |
| R34 | Running from Configure run posts the checked ids and navigates to `/multi-agent-review/<multi_run_id>` | `:252 (AC-34)` | clear | S13, S18, S21 |
| R35 | The results header shows PR number and title, "N selected agents · parallel", total duration and cost, and a Configure run link, and never says "worktrees" | `:257 (AC-35)` | clear. `MultiAgentRun` has no PR title today, so `pr_title` is added (D3) | S1, S19, S20, S21 |
| R36 | Each column shows name ("Unknown agent" if null), status, score ring, duration, cost, finding rows, count, View trace, the error when failed and a label when cancelled | `:260 (AC-36)` | clear | S1, S19, S21 |
| R37 | While any column runs, refetch at most every 3 s and subscribe SSE for each running run; stop once none runs | `:264 (AC-37)` | clear | S13, S19, S21 |
| R38 | View trace sets `?trace=<run_id>` and opens the one shared `RunTraceDrawer`, with `running` while that column runs | `:267 (AC-38)` | clear | S12, S19, S21 |
| R39 | Tabs view: no POST; one tab per column (name + score); the selected tab shows a summary card over its findings rendered by the **existing** `FindingCard` | `:271 (AC-39)` | clear. Placement is open, because importing a route-private `_components` into another route is against this repo's own idiom (**Q2**). Default: import in place | S19, S21 |
| R40 | Accept, Dismiss and Turn into eval case use the PR page's existing endpoints; Learn and Reply are disabled with a "coming soon" tooltip and send no request | `:275 (AC-40)` | clear | S19, S21 |
| R41 | The disagree block renders in both views: one row per group (`file:start[–end]`, title, one cell per take); the conflicts toggle filters to `divergent`; expanding lists each finding as an agent-labelled `FindingCard` | `:278 (AC-41)` | clear | S19, S21 |
| R42 | All model text renders as text; an `<img onerror>` title creates no `img` | `:286 (AC-42)` | clear | S19, S21 |
| R43 | The branch diff against `origin/main` touches no CI module, `agent-runner/`, CI Runs page, agent CI tab, or `contracts/eval-ci.ts` | `:289 (AC-43)` | clear (mechanical; the session runs it) | V-table, C1 |
| R44 | Before `done`: measured 1-agent vs 3-agent numbers (tokens per agent, wall-clock, per-agent duration, total cost, group/divergent counts) in the spec and the PR description, unadjusted | `:292 (AC-44)` | **ambiguous**: group/divergent counts do not exist for the 1-agent run, because AC-4 creates no multi-agent run for it | **Q3** · M1 |
| R45 | Two implementers run sequentially (server, then client), with a third only for at most one fix iteration | user (relayed): "Execution mode is already chosen: 2 implementer agents, sequential" | clear | `## Execution mode` |
| R46 | Reviewers are plan-verifier then architecture-reviewer, with at most one fix iteration each, and no `/code-review` or `test-writer` in this run | user (relayed): "plan-verifier first, then architecture-reviewer; at most one fix iteration each" | clear | `## Execution mode` |
| R47 | Simplicity: prefer cuts, and flag spec items that cost more than they look | user (relayed): "Simplicity is a goal … prefer cuts over additions" | clear | `## Recommendations`, D1–D9 |

**Under-planning check:** 45 of 47 rows are `clear` and each names a step, the V-table, M1 or `## Execution mode`. Two are `ambiguous` (R13, R44) and carry the defaults of Q1 and Q3. No `clear` row is left unsatisfied.

## Scope
| Package | What changes | Why |
|---|---|---|
| `server/src/vendor/shared/` | `contracts/platform.ts` (`RunRequest`), `contracts/review-api.ts` (`ReviewRunResponse`), `contracts/observability.ts` (multi-agent shapes and the stale `:9` comment), `contracts/knowledge.ts` (`Agent` estimates) | R1–R4, R12–R23, R35 |
| `client/src/vendor/shared/` | The same four edits, mirrored. `observability.ts` and `review-api.ts` are byte-identical across the two copies today (`cmp` clean), so they stay identical | spec `:94-96` |
| `server/` | `db/schema/runs.ts`, generated `0025_*` migration, `modules/reviews/{service,run-executor,routes,helpers}.ts`, new `modules/reviews/multi-agent-grouping.ts`, `modules/reviews/repository.ts` + `repository/{run,review}.repo.ts`, `modules/agents/{repository,service}.ts`, tests under `server/test/` | R1–R23 |
| `client/` | Drawer move to `src/components/run-trace-drawer/`; `AgentPicker/` replaces `RunReviewDropdown/`; `PrDetailHeader`; `app/multi-agent-review/**`; `lib/hooks/{reviews,multiAgentReview,index}.ts`; `lib/utils/multiAgentEstimate.ts`; `vendor/ui/nav.ts` (the allowed exception); `components/app-shell/helpers.ts`; `messages/en/{multiAgentReview,shell}.json` | R24–R42 |
| `reviewer-core/`, `mcp/`, `e2e/` | none | AC-6 adds no prompt path; no flow is added |

## Constraints
| Constraint | Source (`path:line`) | How this plan honors it |
|---|---|---|
| C1. Out of bounds: `server/src/modules/ci/**`, `agent-runner/**`, CI Runs page, agent CI tab, `contracts/eval-ci.ts` | spec `:98-99`, AC-43 | No step names those paths. The session checks the branch diff (V-table) |
| C2. Never hand-edit a migration; schema change, then `pnpm db:generate` + `pnpm db:migrate` | root `AGENTS.md` "Do not touch" | S3 edits schema only. S4 generates and migrates, and reads the SQL before migrating |
| C3. Migrations are not applied on boot | `server/INSIGHTS.md:9-15` | S4 runs `pnpm db:migrate`. The user's dev-app check and M1 need a migrated DB, so `./scripts/dev.sh` migrates first |
| C4. Every `ZodError` becomes **422**, so AC-2's 400s cannot come from Zod | `server/src/app.ts:157-186`; `platform/errors.ts:27` | D1: `RunRequest.agent_ids` is a plain optional string array. Count, uniqueness, uuid shape, existence, enabled state and mutual exclusion are checked in the service as `AppError('invalid_run_request', …, 400)` |
| C5. Drizzle 0.38 `numeric` is a string; convert at the repository boundary | `server/INSIGHTS.md:144-150`; `run.repo.ts:72` | S5 applies `Number()` to `cost_usd` in the child-run read. S6 applies `Number()` to `avg(duration_ms)`/`avg(cost_usd)` |
| C6. The architecture gates match exact filenames `(service|run-executor).ts` | `server/INSIGHTS.md:547-553`; `.dependency-cruiser.cjs:30`; `eslint.config.mjs:64` | D2: the read logic goes in the existing `reviews/service.ts`. **No** `multi-agent-service.ts` (the upstream name), which would escape both gates |
| C7. `drizzle-orm` only under `modules/*/repository*` | `.dependency-cruiser.cjs:34-44` | Every new query is in `repository/run.repo.ts`, `repository/review.repo.ts` or `agents/repository.ts`. `multi-agent-grouping.ts` and `helpers.ts` import only `@devdigest/shared` types |
| C8. Adding repository methods breaks hand-rolled `as unknown as` stubs at runtime, and typecheck cannot see it | `server/INSIGHTS.md:114-120` | `AgentsService.list` gains a call (`estimatesForWorkspace`) and `ReviewService.runReview` gains `transaction`/`createMultiAgentRun`. Implementer #1 must `Grep "as unknown as" server/test` for `AgentsRepository`/`ReviewRepository`/`Container` stubs and widen each one in the same edit |
| C9. A new optional mapper parameter breaks point-free `rows.map(fn)` | `server/INSIGHTS.md:201-207` | D6: `toAgentDto` keeps its signature. `AgentsService.list` spreads the estimates in an explicit arrow |
| C10. `buildApp` no longer reaps under `nodeEnv === 'test'`; never assert a reap by booting | `server/INSIGHTS.md:164-171` | `multi-agent.it.test.ts` may seed `running` children freely and asserts no boot-reap |
| C11. `fastify-sse-v2` leaks subscriptions unless the generator wakes on close | `server/INSIGHTS.md:183-189`; `reviews/routes.ts:97-133` | No new SSE route (spec non-goal `:53`). The client reuses `GET /runs/:id/events` per run |
| C12. The rate limit on `POST /pulls/:id/review` stays as is | `reviews/routes.ts:46`; `server/INSIGHTS.md:491-497` | S10 leaves the route `config` untouched; one request carries up to 10 agents |
| C13. A **value** import from `@devdigest/shared` breaks `next build` | `client/INSIGHTS.md:83-89` | Every new client import is `import type`. Limits (`MAX_AGENT_IDS = 10`, `POLL_MS = 3000`) are mirrored in local `constants.ts` |
| C14. Adding a query hook to a rendered component crashes test files that render it without a provider | `client/INSIGHTS.md:206-211` | `FindingCard` already calls `useCreateEvalCase()` (`FindingCard.tsx:53`), so every new test rendering it mocks `@/lib/hooks/evals` and `@/lib/hooks/reviews`. `PrDetailHeader` gains hooks; `page.test.tsx` stubs it (`page.test.tsx:87-88`) |
| C15. `FindingCard`'s header is `role="button"` wrapping Accept/Reject; query by **exact** name | `client/INSIGHTS.md:126-132` | Every S21 action query uses exact names |
| C16. N parallel optimistic mutations from one click roll each other back | `client/INSIGHTS.md:101-107` | A fan-out is **one** POST with `agent_ids`, never one per agent. Select all / Clear are local state only |
| C17. A `?param=` allowlist must be derived from the rendered list | `client/INSIGHTS.md:212-217` | The Columns/Tabs toggle is local state (no URL param). If the implementer adds `?view=`, it derives from a `VIEWS` constant and parses in `helpers.ts` |
| C18. `refetchInterval` runs several times per real refetch; no side effects inside it | `client/INSIGHTS.md:163-169` | S13's `refetchInterval` is a pure function of `query.state.data` (3000 while any column is `running`, else `false`) |
| C19. Falsy `data` means "unknown", not "absent"; destructure `isLoading` | `client/INSIGHTS.md:187-192` | The landing (S18) renders a `role="status"` placeholder while the latest query `isLoading`. It does not flash Configure run before redirecting, and that status element carries its own `aria-label` (`client/INSIGHTS.md:144-151`) |
| C20. The vendored `Chip` is always a `<button>`; status indicators near controls use `Badge` | `client/INSIGHTS.md:175-181` | Column status, severity and "did not flag" cells use `Badge` |
| C21. The kit `Checkbox` has no `disabled` prop | `client/INSIGHTS.md:230-236` | Not needed: only the run buttons get disabled. A native `<input type="checkbox">` is acceptable for an accessible name |
| C22. A new section's fixture can collide with a sibling section's literal-count assertions | `client/INSIGHTS.md:242-247` | The disagree block and the columns both render titles. Tests scope with `within(region)` and never count a title page-wide |
| C23. Every `messages/en/*.json` ships to every route | `client/INSIGHTS.md:52-58` | One new namespace (`multiAgentReview.json`, which the spec requires at `:344`) plus one nav key in `shell.json`. The picker strings also go in `multiAgentReview.json` (upstream's separate `agentPicker.json` is not ported) |
| C24. `client/src/vendor/ui/**` is frozen except `nav.ts` for a new top-level page | root `AGENTS.md` | S17 edits `nav.ts` only. The B-worktree merge order (spec `:103-109`) means A adds the GLOBAL section first |
| C25. Parallel agents share one working directory | root `INSIGHTS.md:76-83` | The two implementers are sequential (R45), so there is no overlap |
| C26. Server tests live in `server/test/` (92 files; **zero** under `server/src`), though vitest also includes `src/**/*.test.ts` | `git ls-files` counts; `server/vitest.config.ts:14` | D5 / **Q4**: the test files the spec places under `server/src/modules/reviews/` go to `server/test/` |
| C27. Agents run concurrently over one shared `diff` object and one fanned-out `RunLogger` | `run-executor.ts:74-79, 181` | S9 changes only the loop. `runOneAgent` is untouched (AC-6). Implementer #1 confirms `reviewPullRequest` does not mutate `diff` (Not found row 1) |

## Decisions I settled
**D1 — Where AC-2's 400s come from.** `RunRequest` gains only `agent_ids: z.array(z.string()).optional()`. A pure `validateAgentIdsShape(ids)` in `reviews/helpers.ts` returns an error message or `null`: length 1–10, unique, each a uuid by regex. A non-uuid would otherwise reach `inArray` and 500. `ReviewService.resolveTargets` then counts the keys present (`!== undefined`) among `agentId`/`all`/`agent_ids`; more than one gives 400. For `agent_ids` it calls `agentsRepo.listByIds` (`agents/repository.ts:96`). If the result is shorter than the request, or any row is `!enabled`, it returns 400. Everything is validated before any row is written. A wrong *type* (`agent_ids: "x"`) stays a Zod 422, which AC-2 does not enumerate.

**D2 — File placement (server).**
- The read methods are added to `ReviewService` in `reviews/service.ts`, which is ring 3 and gated by filename.
- The grouping is a pure ring-1 module, `reviews/multi-agent-grouping.ts`, importing only `@devdigest/shared` types.
- Column mapping and totals go in `reviews/helpers.ts`, the existing pure slot.

The upstream `multi-agent-service.ts` is **not** ported as a file, for the C6 reason.

**D3 — Hand-off contract (exact shapes).** See "Hand-off contract #1 → #2" below.

**D4 — Grouping algorithm and determinism.**
1. Clamp `end = (end_line == null || end_line < start_line) ? start_line : end_line`.
2. Sort findings by `(file, start, end, id)`.
3. Sweep per file: append to the current group while `next.start − 2 ≤ groupMaxEnd + 2`, else open a new group.

This is exactly the transitive closure of AC-16's overlap relation, costs O(F log F), and does no arithmetic over line *ranges*. It replaces upstream's O(F²) pairwise union-find (`git show cf47df3:server/src/modules/reviews/multi-agent-conflicts.ts`), which would fail AC-22's bound at scale. The spec's "union-find" (`:73`) names the behaviour, and the sweep has the same output.

Ordering inside the output:
- Takes are keyed by **`run_id`**, not `agent_id`, because a deleted agent's run still has a column. They are ordered by `(agent_name ?? '', run_id)` *inside* the function, so permuting the columns cannot change the output (AC-21).
- `finding_ids` inside a take are ordered by `(start, id)`.

**D5 — Server test locations: `server/test/`** (C26). Mapping: spec `reviews/service.test.ts` → `server/test/reviews-multi-trigger.test.ts`; `run-executor.test.ts` → `server/test/reviews-fanout.test.ts`; `multi-agent.service.test.ts` → `server/test/multi-agent-read.test.ts`; `multi-agent-grouping.test.ts` → `server/test/multi-agent-grouping.test.ts`; `server/test/multi-agent.it.test.ts` keeps its spec path. `server/test/run-executor.test.ts` already exists and is the **eval** executor's test, so it is not reused. Confirm or overrule in Q4.

**D6 — Estimates.** `Agent.est_duration_ms` and `Agent.est_cost_usd` are `z.number().nullish()`, not required. `Agent` is also produced by get, create, update and promote (`EvalPromoteResult.agent`), and none of those paths has an aggregate to hand. `AgentsService.list` sets both explicitly (`?? null`) on every agent, which satisfies AC-23 for `GET /agents`. `toAgentDto` is unchanged (C9). Upstream's `has_history` is **not** ported: "has history" is `est_duration_ms != null`.

**D7 — Parent and children in one transaction.** `runReview` wraps `createMultiAgentRun` plus the N `createAgentRun(…, multiRunId)` calls in `this.repo.transaction` (`repository.ts` `transaction()`), so a half-created fan-out cannot exist. Single-target requests keep today's path.

**D8 — Configure run PR picker scope.** The PR list API is per repo (`usePulls(repoId)`, `client/src/lib/hooks/core.ts:109`). The picker therefore lists the **active repo's** PRs, or the first repo's (upstream did the same with `useActiveRepo`). `?pr=<prId>` preselects via `usePullDetail(prId)` (`core.ts:147`). There is no cross-repo PR search.

**D9 — Drawer move.** `git mv` the whole `RunTraceDrawer/` folder to `client/src/components/run-trace-drawer/`, keeping `RunTraceDrawer.tsx`, `_components/`, `constants.ts`, `helpers.ts`, `styles.ts` and `index.ts` as the barrel. The only content edits are import paths: the test's `messages/en/runs.json` relative path, and the PR `page.tsx:18` import. Behaviour does not change.

### Upstream port map (`cf47df3`) and where 0021 deliberately differs
| Upstream | 0021 |
|---|---|
| `POST /pulls/:id/multi-agent-run` + `MultiAgentRunRequest`/`MultiAgentRunTriggerResult` | **Extend** `POST /pulls/:id/review` (`agent_ids`, `multi_run_id`). No new trigger contract |
| `GET /pulls/:id/multi-agent?multiRunId=` | `GET /multi-agent/:id` (spec `:69`) |
| `computeConflicts`, roster = every agent, takes by `agent_id`, note `'Did not flag'` | Takes only for **done** columns, keyed by `run_id`; ignored note `""`; `finding_ids` attribution; `divergent`; ±2 tolerance; O(F log F) sweep |
| `agent_name: 'Unknown agent'` server-side, `agent_id: ''` | `agent_id: null`, `agent_name: null`; the client renders the i18n "Unknown agent" |
| `AgentColumnFinding` subset | Full `FindingRecord` (AC-14). `AgentColumnFinding` is deleted from both copies; nothing consumes it |
| `toAgentDto(row, estimate?)` + `has_history` | Spread in `list()` only; no `has_history` (D6) |
| Own `multi-agent-review/_components/FindingCard` | Reuse the PR page's `FindingCard` (AC-39) |
| Separate `agentPicker.json` | Strings in `multiAgentReview.json` (spec `:344`) |
| Results URL `/multi-agent-review/<prId>?multiRunId=` | `/multi-agent-review/<multiRunId>` |
| Learn / Reply | Rendered **disabled**, "coming soon" (AC-40) |
| `estimatesForWorkspace` SQL | Ported as is (`avg(...)` over `status='done'`, grouped by `agent_id`, `Number()` on read) |
| `Promise.allSettled` over `jobs.map` | Ported as is |

### Hand-off contract #1 → #2
Implementer #2 starts from this block and Implementer #1's report. #1 must report any deviation from it.

```ts
// platform.ts
RunRequest = z.object({ agentId: z.string().optional(), all: z.boolean().optional(),
                        agent_ids: z.array(z.string()).optional() });
// review-api.ts
ReviewRunResponse = z.object({ pr_id: z.string(), runs: z.array(ReviewRunTarget),
                               reviews: z.array(ReviewRecord), multi_run_id: z.string().nullable() });
// knowledge.ts  (Agent)
est_duration_ms: z.number().nullish(), est_cost_usd: z.number().nullish(),
// observability.ts
AgentColumnStatus = z.enum(['running','done','failed','cancelled']);
AgentColumn = z.object({ run_id: z.string(), agent_id: z.string().nullable(), agent_name: z.string().nullable(),
  provider: z.string().nullable(), model: z.string().nullable(), status: AgentColumnStatus,
  error: z.string().nullable(), verdict: z.string().nullable(), score: z.number().int().nullable(),
  summary: z.string().nullable(), duration_ms: z.number().int().nullable(), cost_usd: z.number().nullable(),
  findings: z.array(FindingRecord) });               // FindingRecord from './review-api.js'
ConflictTake = z.object({ run_id: z.string(), agent_id: z.string().nullable(), persona: z.string().nullable(),
  verdict: z.union([Severity, z.literal('ignored')]), note: z.string(), finding_ids: z.array(z.string()) });
Conflict = z.object({ file: z.string(), start_line: z.number().int(), end_line: z.number().int(),
  title: z.string(), divergent: z.boolean(), takes: z.array(ConflictTake) });
MultiAgentRun = z.object({ id, pr_id: z.string(), pr_number: z.number().int(), pr_title: z.string(),
  ran_at: z.string(), agent_count: z.number().int(), total_duration_ms: z.number().int(),
  total_cost_usd: z.number().nullable(), columns: z.array(AgentColumn), conflicts: z.array(Conflict) });
MultiAgentRunRef = z.object({ id: z.string(), pr_id: z.string(), pr_number: z.number().int(), ran_at: z.string() });
MultiAgentLatest = z.object({ run: MultiAgentRunRef.nullable() });   // Q1 default
```
Check for an import cycle: `review-api.ts` must not import `observability.ts`. Implementer #1 confirms.

| Route | Request | 2xx body | Errors |
|---|---|---|---|
| `POST /pulls/:id/review` | `{agentId}` \| `{all:true}` \| `{agent_ids:[…]}` | `ReviewRunResponse` | 400 `invalid_run_request` (AC-2); 404 unknown `agentId` / PR (unchanged) |
| `GET /multi-agent/:id` | `IdParams` (uuid) | `MultiAgentRun` | 404 `not_found`; 422 malformed uuid |
| `GET /pulls/:id/multi-agent/latest` | `IdParams` | `MultiAgentLatest` | 404 unknown/foreign PR |
| `GET /multi-agent/latest` | — | `MultiAgentLatest` | — |
| `GET /agents` | — | `Agent[]` with both estimate fields set (number or `null`) | — |

`/multi-agent/latest` is a static segment and outranks `/multi-agent/:id` in find-my-way, so registration order does not matter.

## Steps

### Implementer #1 — server + both contract copies (S1–S11)

1. **S1** — Server contracts per the hand-off block: `server/src/vendor/shared/contracts/{platform,review-api,observability,knowledge}.ts`. Rewrite the `observability.ts:5-16` header so it names `POST /pulls/:id/review` and the read routes, not `/multi-agent-run` (spec `:56-57`). · ring 2 · skill: `zod`, `typescript-expert` · test: extend `server/test/contracts.test.ts`. `MultiAgentRun` parses a column with `agent_id: null` + `status: 'cancelled'` + a full `FindingRecord`, and rejects `cost_usd: "0.01"`. `ConflictTake` requires `finding_ids`. `RunRequest` accepts `{agent_ids: []}` (shape only; the 400 is the service's). `Agent` parses with the estimate fields absent and with them null. · satisfies: R1, R3, R4, R12–R14, R17, R20, R23, R35, R36
2. **S2** — Mirror S1 into `client/src/vendor/shared/contracts/` the same four files. `observability.ts` and `review-api.ts` stay **byte-identical** to the server copies. Apply the `platform.ts`/`knowledge.ts` edits as changes, not file copies, because those copies have drifted (root `INSIGHTS.md:30-38`, `client/INSIGHTS.md:224-230`). · ring 2 · skill: `zod`, `typescript-expert` · test: `cmp` of the two identical pairs (V-table) plus `cd client && pnpm typecheck` · satisfies: R14, R35 (client side)
3. **S3** — `server/src/db/schema/runs.ts`: add `multiRunId: uuid('multi_run_id').references(() => multiAgentRuns.id, { onDelete: 'set null' })` to `agentRuns`, plus an index `agent_runs_multi_run_id_idx` in the table's index callback. The lazy callback tolerates `multiAgentRuns` being declared later (`:96`). · ring 4 · skill: `postgresql-table-design`, `drizzle-orm-patterns`, `onion-architecture` · test: S11's `.it` column assertion · satisfies: R3, R11
4. **S4** — `cd server && pnpm db:generate`, then **read** `src/db/migrations/0025_*.sql`. It must contain only `ADD COLUMN`, `ADD CONSTRAINT … FOREIGN KEY … ON DELETE set null` and `CREATE INDEX`. Expect `meta/0025_snapshot.json` and a `_journal.json` append. Then run `pnpm db:migrate`. If anything else appears, or a prompt, stop and report; never edit. · ring 4 · skill: none (`skip`, `skill-map.json` "skip") · test: V-table AC-11 check · satisfies: R11
5. **S5** — Repository, ring 4. Files: `server/src/modules/reviews/repository/run.repo.ts`, `repository/review.repo.ts`, and the facade `repository.ts`.
   - `createAgentRun` gains an optional `multiRunId?: string | null`.
   - New `createMultiAgentRun(db, {workspaceId, prId}) → id`.
   - New `getMultiAgentRun(db, workspaceId, id)`: the parent joined to `pull_requests` for `number`/`title`, workspace-scoped.
   - New `latestMultiAgentRun(db, workspaceId, prId?)`: `ORDER BY ran_at DESC, id DESC LIMIT 1`, returning ref fields.
   - New `childRunsForMultiRun(db, multiRunId)`: `leftJoin agents` for the name; `cost_usd` via `Number()` (C5).
   - New `reviewsWithFindingsForRuns(db, runIds)` in `review.repo.ts`: one query for reviews by `run_id`, one for their findings, no N+1.
   - A facade method on `ReviewRepository` for each. · skill: `drizzle-orm-patterns`, `onion-architecture` · test: S11 `.it` · satisfies: R3, R12–R15
6. **S6** — `server/src/modules/agents/repository.ts`: `estimatesForWorkspace(workspaceId): Map<agentId, {durationMs: number|null; costUsd: number|null}>`, ported from upstream: `avg()` over `status='done'`, grouped, `Number()` on read. `agents/service.ts` `list()` spreads `est_duration_ms`/`est_cost_usd` (`?? null`) in an explicit arrow (D6, C9). · ring 4 / ring 3 · skill: `drizzle-orm-patterns`, `onion-architecture` · test: S11 `.it` (the spec's 1000/3000 ms, $0.01/$0.03 → 2000 / 0.02 case, and the failed/cancelled/running-only case → both null); widen any `AgentsRepository` stub (C8) · satisfies: R23
7. **S7** — Pure ring-1 functions.
   - **`server/src/modules/reviews/multi-agent-grouping.ts`:** `groupFindings(columns: GroupingColumn[]): Conflict[]` per D4 and AC-16–AC-22. `GroupingColumn` is `{run_id, agent_id, agent_name, status, findings: {id, file, start_line, end_line, severity, title}[]}`.
   - **`server/src/modules/reviews/helpers.ts`, `validateAgentIdsShape`:** D1.
   - **`server/src/modules/reviews/helpers.ts`, `toMultiAgentRun`:** `toMultiAgentRun(parent, children, reviewsByRun)` maps columns. `status` falls back to `'running'` when null. `findings` go through the existing `findingRowToDto`, and `score`, `error`, `verdict` and `summary` are filled in. It also computes `total_duration_ms` (max non-null, else 0), `total_cost_usd` (null-safe sum, else null), `agent_count`, and orders columns by `(agent_name ?? '', run_id)`. It then calls `groupFindings`.

   `reduce` accumulators get explicit `number | null` types. · ring 1 · skill: `onion-architecture`, `typescript-expert` · test: S11 `multi-agent-grouping.test.ts`, `multi-agent-read.test.ts` · satisfies: R2, R14–R22
8. **S8** — `server/src/modules/reviews/service.ts`.
   - `resolveTargets(ws, {agentId?, all?, agent_ids?})`: mutual exclusion, then the D1 checks. The existing `agentId`/`all` branches are unchanged.
   - `runReview(...)`: when `targets.length >= 2`, it creates the parent and children in one `repo.transaction` (D7) and returns `{ runs, reviews: [], multi_run_id }`. Otherwise `multi_run_id: null` and today's path.
   - `getMultiAgentRun(ws, id)`: 404 via `NotFoundError` when absent.
   - `latestMultiAgentRun(ws, prId?)`: when `prId` is given, `getPull(ws, prId)` first (404 on a foreign PR, mirroring `getIntent` `:185-191`); returns `{ run: ref | null }`.

   No SDK and no drizzle. · ring 3 · skill: `onion-architecture`, `security`, `typescript-expert` · test: S11 `reviews-multi-trigger.test.ts` · satisfies: R1–R5, R12, R13
9. **S9** — `server/src/modules/reviews/run-executor.ts:130-159`: replace the `for … await` with `await Promise.allSettled(jobs.map(async ({agent, runId}) => { …same try/catch body… }))`. Change nothing above `:130` (diff + intent once, `failAll` only on a diff throw) and nothing in `runOneAgent`. Update the class doc comment (`:46-51`) to say "in parallel". · ring 3 · skill: `onion-architecture`, `typescript-expert` · test: S11 `reviews-fanout.test.ts` · satisfies: R6–R10
10. **S10** — `server/src/modules/reviews/routes.ts`.
    - The POST handler passes `agent_ids` through and returns `{ pr_id, runs, reviews, multi_run_id }`. The rate-limit `config` is untouched (C12).
    - Add `GET /multi-agent/latest`, `GET /multi-agent/:id` (`IdParams`) and `GET /pulls/:id/multi-agent/latest` (`IdParams`), each calling `getContext` and then the service. These handlers are transport only.
    - Extend the header route map (`:10-19`). · ring 4 · skill: `fastify-best-practices`, `onion-architecture`, `zod`, `security` · test: S11 `.it` · satisfies: R1, R3, R12, R13
11. **S11** — Server tests. Implementer #1 writes all of them and runs only the hermetic ones.
    - `server/test/reviews-multi-trigger.test.ts`, hermetic. `new ReviewService(stubContainer, stubRepo)` (the constructor already takes the repo, `service.ts:49-52`), with `vi.spyOn(ReviewRunExecutor.prototype, 'executeRuns').mockResolvedValue()`. Cases:
      - 2 valid ids → 2 `createAgentRun` calls, both with the same `multiRunId`, one `createMultiAgentRun`, and `multi_run_id` returned;
      - `all:true` with 3 enabled → one parent;
      - empty / 11 / duplicate / non-uuid / unknown / foreign (absent from `listByIds`) / disabled / `agentId+agent_ids` / `all+agent_ids` → `AppError` status **400**, with zero create calls;
      - 1 id → `multi_run_id: null`, no parent, `multiRunId` undefined;
      - a disabled agent via `agentId` → runs (R5).
    - `server/test/reviews-fanout.test.ts`, hermetic, following `run-executor-cancel.test.ts:157`'s real-instance-plus-patch pattern, with `vi.mock` on `diff-loader.js` and `intent.js`. Cases:
      - 3 agents → `loadDiff`/`deriveIntent` called once each, `runOneAgent` 3× (spy on the private method);
      - deferred stubs → all 3 started before any resolves;
      - one rejects with `Error`, one with `RunCancelledError`, the third resolves → `executeRuns` resolves;
      - `loadDiff` throws → `completeAgentRun(…, {status:'failed', error: /Failed to load PR diff/})` per job;
      - zero-file diff → `failAll` path not taken, `runOneAgent` 3×.
    - `server/test/multi-agent-grouping.test.ts`: the spec's `:392` table verbatim, plus one 3-done + 1-failed + 1-cancelled case. The 500-finding timing test uses `performance.now()` with a < 100 ms assertion.
    - `server/test/multi-agent-read.test.ts`: `toMultiAgentRun` totals (`[1200,null,800]` → 1200, all null → 0; `[0.01,null,0.02]` → 0.03 by `toBeCloseTo`, all null → null), `typeof cost_usd === 'number'`, a null-agent column → `agent_id: null`, and a null status → `'running'`.
    - `server/test/multi-agent.it.test.ts`, **written, NOT run**. It covers the spec's `:390` seeds, plus an AC-11 assertion (`information_schema` shows `multi_run_id` uuid nullable and the FK is `SET NULL`), and inject-level AC-1/3/4 (the parent row exists with stamped children; a single run leaves the column NULL). It boots `buildApp` freely (C10).

    Also widen every hand-rolled stub the new calls hit (C8). · skill: `typescript-expert` (test lane) · satisfies: the test half of R1–R23

**Implementer #1's report must include:** the final contract text if it differs from the hand-off block, the generated `0025_*` filename, and any test stubs widened.

### Implementer #2 — client (S12–S22)

12. **S12** — `git mv "client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer" client/src/components/run-trace-drawer`. Fix `index.ts` (the barrel; keep the default export), the test's `messages/en/runs.json` relative path, and `"[number]/page.tsx":18` → `import RunTraceDrawer from "@/components/run-trace-drawer"`. No other content edits (D9). · shared component · skill: `react-code-organization`, `react-best-practices`, `next-best-practices` · test: the moved `RunTraceDrawer.test.tsx` + `helpers.test.ts` pass unchanged apart from paths · satisfies: R38
13. **S13** — Hooks.
    - **`client/src/lib/hooks/reviews.ts`:** `useRunReview` input gains `agentIds?: string[]` → body `agent_ids`. It also invalidates `["pr-latest-multi-agent", prId]` and `["multi-agent-latest"]` on success.
    - **New `client/src/lib/hooks/multiAgentReview.ts`:**
      - `useMultiAgentRun(id)`: key `["multi-agent-run", id]`; `refetchInterval: (q) => q.state.data?.columns.some(c => c.status === "running") ? POLL_MS : false` (C18).
      - `useLatestMultiAgentRun()`: key `["multi-agent-latest"]`.
      - `usePrLatestMultiAgentRun(prId)`: `enabled: !!prId`.
    - **`client/src/lib/hooks/index.ts`:** re-export.

    All contract imports are `import type` (C13). · client data layer · skill: `react-best-practices`, `next-best-practices`, `typescript-expert` · test: driven through S21 (mocked) · satisfies: R26, R27, R29, R34, R37
14. **S14** — New `client/src/lib/utils/multiAgentEstimate.ts`, the path the spec names (`:396`). Two functions:
    - `summariseEstimate(agents): { duration_ms: number; cost_usd: number | null } | null`. It ranges over agents with `est_duration_ms != null` and returns null when there are none. Duration is the max; cost is the null-safe sum.
    - `formatAgentEstimate(agent)`, used by both the picker (`~Ns`) and the cards ("duration · cost"). It returns `null` for "no history".

    Pure. · client lib · skill: `react-code-organization`, `typescript-expert` · test: `client/src/lib/utils/multiAgentEstimate.test.ts` (an agent without history changes neither total; null when none has history) · satisfies: R31, R33
15. **S15** — New `client/src/app/repos/[repoId]/pulls/[number]/_components/AgentPicker/{AgentPicker.tsx, AgentPicker.test.tsx, styles.ts, helpers.ts, constants.ts, index.ts}`.
    - The trigger `Button` toggles a panel. Escape closes it.
    - The panel lists the **enabled** agents from `useAgents()`, each a labelled checkbox with `~Ns` or "no history" (S14).
    - It has a Clear control and a "Configure agents…" link to `/multi-agent-review?new=1&pr=<prId>`.
    - The run button is labelled "Run multi-agent review (N)" and is disabled at N=0.
    - On run, it calls `mutateAsync({prId, agentIds})`. If one id was checked it calls `onRunsStarted()` (today's behaviour, `PrDetailHeader.tsx:99-104`). Otherwise it `router.push(`/multi-agent-review/${multi_run_id}`)`.
    - It keeps `warnMerged`, `onRunStart` and `onRunSettled`.
    - **Delete** `_components/RunReviewDropdown/` and its test. Remove the now-unused `prReview.json` `runReview.*` keys only if a grep finds no other user. · client feature · skill: `react-best-practices`, `react-code-organization`, `next-best-practices`, `security` · test: `AgentPicker.test.tsx` per spec `:393` · satisfies: R24–R26
16. **S16** — `PrDetailHeader.tsx`: swap in `AgentPicker`, and add a "Multi-Agent Review" link (`next/link`) to `/multi-agent-review/<run.id>` only when `usePrLatestMultiAgentRun(prId).data?.run` exists. · client feature · skill: `react-best-practices`, `react-code-organization`, `next-best-practices` · test: new `PrDetailHeader/PrDetailHeader.test.tsx` (link present with the id / absent on `{run:null}`), mocking `@/lib/hooks/multiAgentReview` and `AgentPicker` · satisfies: R27
17. **S17** — Nav. Three edits:
    - `client/src/vendor/ui/nav.ts`: a new `{ section: "GLOBAL", items: [{ key: "multi-agent-review", label: "Multi-Agent Review", icon: <existing IconName>, href: "/multi-agent-review" }] }`, with the same documented-exception comment as `:23-25`. No `gKey`.
    - `client/src/components/app-shell/helpers.ts`, `activeKeyFor`: add `if (pathname.startsWith("/multi-agent-review")) return "multi-agent-review";`.
    - `shell.json`: the label key, if AppShell translates nav labels (check against `AppShell.tsx`). · vendored exception + shared component · skill: `react-code-organization` (nav.ts is `skip`) · test: extend `client/src/components/app-shell/helpers.test.ts` (`/multi-agent-review` and `/multi-agent-review/abc` → `"multi-agent-review"`; `NAV` has a `GLOBAL` group holding that item) · satisfies: R28
18. **S18** — Landing and Configure run.
    - **`client/src/app/multi-agent-review/page.tsx`:** thin; renders `<MultiAgentLanding/>`.
    - **`_components/MultiAgentLanding/{MultiAgentLanding.tsx, helpers.ts, index.ts}`:**
      - `landingTarget(isNew, latest)` is pure.
      - While `isLoading` it renders a `role="status"` with an `aria-label` (C19).
      - It calls `router.replace` when a latest run exists and `?new` ≠ `1`.
      - Otherwise it renders `ConfigureRun` with `initialPrId = ?pr`.
    - **`_components/ConfigureRun/{ConfigureRun.tsx, ConfigureRun.test.tsx, helpers.ts, styles.ts, constants.ts, index.ts}`:**
      - The PR picker follows D8.
      - The empty state "Pick a pull request first" shows when no PR is selected.
      - With a PR selected, there is one card per enabled agent (name, `description`, estimate or "no history"), with keyboard-operable checkboxes.
      - Select all is present.
      - The run button is disabled below 2.
      - The S14 summary renders "≈ … · … · parallel fan-out", or nothing.
      - On run, it calls `mutateAsync({prId, agentIds})` → `router.push(`/multi-agent-review/${multi_run_id}`)`.

    The page sits under `app/layout.tsx`'s Suspense, so `useSearchParams` is safe. That has not been proven by `next build`; see the V-table. · client feature · skill: `react-best-practices`, `react-code-organization`, `next-best-practices` · test: `client/src/app/multi-agent-review/page.test.tsx` (AC-29's three cases) + `ConfigureRun.test.tsx` (spec `:396`) · satisfies: R29–R34
19. **S19** — The results route.
    - **`client/src/app/multi-agent-review/[multiRunId]/page.tsx`:** thin; renders `<ResultsView id={params.multiRunId}/>`.
    - **`client/src/app/multi-agent-review/_components/ResultsView/{ResultsView.tsx, ResultsView.test.tsx, helpers.ts, styles.ts, constants.ts, index.ts}`:**
      - The header shows `#pr_number pr_title`, "N selected agents · parallel", the duration and cost totals, and a Configure run link to `?new=1&pr=<pr_id>`.
      - The Columns/Tabs toggle is a `role="tablist"` or a pressed-button pair (C17).
      - The live status calls `useRunEvents(runningRunIds)` and, when that stream reports not running, invalidates `["multi-agent-run", id]`. Polling comes from S13.
      - `?trace=<run_id>` mounts `@/components/run-trace-drawer`. It passes `findings`, `agentName`, `prNumber` and `running={column.status === "running"}`, and `onClose` clears the param.
    - **`ResultsView/_components/ColumnsView/`:** one column per `AgentColumn`. Each shows the name or the i18n "Unknown agent", a status `Badge`, a score ring (an existing kit primitive if one exists, else a text score), duration, cost, finding rows (severity `Badge`, title, `file:line`), the count, View trace, `error` when failed, and the cancelled label.
    - **`_components/TabsView/{TabsView.tsx, TabsView.test.tsx, styles.ts, index.ts}`:** a keyboard-operable tab per column ("name · score"). The selected tab shows a summary card (summary, duration, cost, View trace) over `AttributedFinding`s.
    - **`_components/AttributedFinding/{AttributedFinding.tsx, index.ts}`:**
      - It renders the agent label and the **existing** `FindingCard` (placement per Q2).
      - `onAction` calls `useFindingAction()` and invalidates `["multi-agent-run", id]` on settle.
      - Learn and Reply are `<button disabled title={t("comingSoon")}>` with `aria-describedby` text, so they work without hover.
    - **`_components/DisagreeBlock/{DisagreeBlock.tsx, DisagreeBlock.test.tsx, helpers.ts, styles.ts, index.ts}`:**
      - It is rendered in both views.
      - Each row shows `file:start_line[–end_line]`, the title, and one cell per take: the agent name, then the severity `Badge` or "did not flag", then the note.
      - It has a "Show only conflicts" toggle (a native checkbox with a label) that filters to `divergent`.
      - The row expand control is a `<button aria-expanded>`. It lists the `finding_ids` resolved through the columns as `AttributedFinding`s.

    All model text is rendered as React text children. There is no `dangerouslySetInnerHTML` and no markdown renderer for titles or notes (R42). · client feature · skill: `react-best-practices`, `react-code-organization`, `next-best-practices`, `security` · test: S21 · satisfies: R35–R42
20. **S20** — `client/messages/en/multiAgentReview.json`: new; camelCase keys for picker, landing, configure, results, columns, tabs, disagree, status, `unknownAgent`, `didNotFlag`, `comingSoon`, `parallel`. The word "worktrees" appears nowhere. Plus the nav key in `shell.json`, if S17 needs it. Check how namespaces are loaded (i18n request config) and register the new file if they are enumerated. · client i18n · skill: none routed (`client/messages/**` is `skip`) · test: S21's rendered strings; a ResultsView assertion that `queryByText(/worktree/i)` is null · satisfies: R35, R24–R41 copy
21. **S21** — Client tests, per spec `:393-398`. Every file that renders `FindingCard` mocks `@/lib/hooks/evals` + `@/lib/hooks/reviews` (C14). Action queries use **exact** names (C15) and are scoped with `within(...)` (C22).
    - **`AgentPicker.test.tsx`**
    - **`PrDetailHeader.test.tsx`**
    - **`app-shell/helpers.test.ts`**
    - **`multi-agent-review/page.test.tsx`**
    - **`ConfigureRun.test.tsx`**
    - **`multiAgentEstimate.test.ts`**
    - **`ResultsView.test.tsx`:**
      - fake timers: one refetch within 3 s while a column is running, none after all are done;
      - `useRunEvents` is called with the running ids only;
      - View trace sets `?trace=` and mounts the shared drawer with `running`;
      - toggling issues no POST.
    - **`TabsView.test.tsx`:** Learn/Reply are disabled, and clicking them leaves the `fetch` spy uncalled.
    - **`DisagreeBlock.test.tsx`:** includes `<img src=x onerror=alert(1)>` rendered as text, with `container.querySelector('img')` null.
    - **New `client/src/test/multi-agent-static.test.ts`:**
      - exactly one `RunTraceDrawer.tsx` under `client/src` (fs walk);
      - no `dangerouslySetInnerHTML` under `client/src/app/multi-agent-review/`. · skill: `react-testing-library` · satisfies: the test half of R24–R42
22. **S22** — Hand-off hygiene:
    - `grep -rln "RunReviewDropdown\|_components/RunTraceDrawer" client/src` must be empty;
    - update the stale doc comments in `reviews.ts:187` and `page.tsx:3`. · skill: — · satisfies: R24, R38

### Post-implementation (session + user)
**M1 — AC-44 measurement** (R44, R47). Run it after `plan-verifier` and `architecture-reviewer` are clean, on the dev app with a real `OPENROUTER_API_KEY`.
1. Start `./scripts/dev.sh`; it migrates and seeds (C3). Pick one demo PR (seeded PR #482 is the default) and three **enabled** agents on the same provider. Record their ids, models and the PR's `head_sha`.
2. **Warm-up (discarded).** Run one single-agent run first. Intent classification and the repo-intel caches are per-PR, so the first run would otherwise pay costs the later ones do not. Record whether each measured run's trace has `intent_call` non-null, because that differs between cold and warm runs.
3. **1-agent run.** Note `t0`, then `POST /pulls/<prId>/review` with `{"agent_ids":["<A>"]}`. Poll `GET /pulls/<prId>/runs/active` every 1 s until it is empty, and note `t1`. Wall-clock = `t1 − t0`. From `GET /pulls/<prId>/runs` (the newest row) take `tokens_in`, `tokens_out`, `duration_ms` and `cost_usd`.
4. **3-agent run.** Note `t0`, then `POST` with `{"agent_ids":["<A>","<B>","<C>"]}` and keep `multi_run_id`. Poll `GET /multi-agent/<multi_run_id>` every 1 s until no column is `running`, and note `t1`. From the same payload take, per column, `duration_ms` and `cost_usd`, plus `total_cost_usd`, `conflicts.length`, and the count of `divergent: true`. Take the per-agent `tokens_in`/`tokens_out` from `GET /pulls/<prId>/runs`, matched by `run_id`.
5. Record exactly what was measured in the spec's `## Measurement results` table (`:406-409`) **and** in the PR description. State the observed ratio (3-agent wall-clock ÷ 1-agent wall-clock, and the sum of per-agent durations ÷ 3-agent wall-clock) without rounding toward 3×. Name the provider and models, and say whether intent ran.
6. Groups/divergent for the 1-agent row follow Q3's default: "n/a — a single-agent run creates no multi-agent run (AC-4)".

The 1-second polling resolution goes in the note.

## Skills for the implementer
| Path (glob) | Skills (`skill-map.json`) | What they will require here |
|---|---|---|
| `{server,client}/src/vendor/shared/contracts/*.ts` | `zod`, `typescript-expert` | A schema and its `z.infer` share one name; `.nullable()` vs `.nullish()` used deliberately (D6); no import cycle between `observability.ts` and `review-api.ts` |
| `server/src/db/schema/runs.ts` | `onion-architecture`, `drizzle-orm-patterns`, `postgresql-table-design`, `security`, `typescript-expert` | FK with `onDelete: 'set null'`, an index on the FK column, snake_case ↔ camelCase |
| `server/src/modules/reviews/repository{.ts,/**}`, `server/src/modules/agents/repository.ts` | `onion-architecture`, `drizzle-orm-patterns`, `security`, `typescript-expert` | Workspace scoping on every read; no N+1 (two queries for reviews+findings); `Number()` on numeric |
| `server/src/modules/reviews/{service,run-executor}.ts`, `agents/service.ts` | `onion-architecture`, `security`, `typescript-expert` | Ring 3: no drizzle, no SDK; validation before writes; `allSettled`, never `all` |
| `server/src/modules/reviews/{helpers,multi-agent-grouping}.ts` | `onion-architecture`, `security`, `typescript-expert` | Provably pure; typed accumulators; no I/O |
| `server/src/modules/reviews/routes.ts` | `onion-architecture`, `fastify-best-practices`, `security`, `typescript-expert`, `zod` | Transport only; `IdParams`; rate-limit config untouched |
| `server/test/**` | `typescript-expert` | `.it.test.ts` for anything importing `test/helpers/pg.ts` |
| `client/src/**/*.{ts,tsx}` (not vendor, not tests) | `react-best-practices`, `react-code-organization`, `next-best-practices`, `security`, `typescript-expert` | `_components/<PascalCase>/` beside its test, styles, helpers and constants; shared component in `src/components/<kebab>/` + `index.ts`; hooks in `lib/hooks/<domain>.ts`; no hardcoded copy; `import type` only |
| `client/**/*.test.{ts,tsx}` | `react-testing-library` | Role and exact-name queries; `getByRole("dialog")`, never `heading` (`client/INSIGHTS.md:120-126`); `role="status"` named by `aria-label` |
| `client/src/vendor/ui/nav.ts`, `client/messages/**`, `server/src/db/migrations/**` | **skip** | Repo rules only; `nav.ts` is the one sanctioned vendored edit |

## Verification
| Package | Command | Who | What counts as pass |
|---|---|---|---|
| `server/` | `cd server && pnpm typecheck && pnpm lint && pnpm exec vitest run --exclude '**/*.it.test.ts'` | Implementer #1 | All green. `pnpm lint` includes `pnpm arch`. Prove the gate covers the new pure module by temporarily adding `import { eq } from 'drizzle-orm'` to `multi-agent-grouping.ts`: it must give exactly 1 error. Then revert (`server/INSIGHTS.md:547-553`) |
| `client/` (contracts only) | `cd client && pnpm typecheck` | Implementer #1 | Green after S2. This proves the mirror compiles before #2 starts |
| contracts | `cmp server/src/vendor/shared/contracts/observability.ts client/src/vendor/shared/contracts/observability.ts && cmp …/review-api.ts …/review-api.ts` | Implementer #1, then plan-verifier | Both silent |
| `server/` migration (AC-11) | `git status --short server/src/db/migrations` + `Read` of `0025_*.sql` | Implementer #1, then plan-verifier | Only `0025_*.sql`, `meta/0025_snapshot.json` and a `_journal.json` change; the SQL contains only `ADD COLUMN`, `ADD CONSTRAINT` and `CREATE INDEX` |
| `client/` | `cd client && pnpm typecheck && pnpm lint && pnpm test` | Implementer #2 | All green; the moved drawer tests green |
| spec | `bash scripts/check-specs.sh` | session | Green (the session also files this plan and the Phases row) |
| AC-43 | `git diff --name-only origin/main...HEAD` (or `git log --stat origin/main..HEAD`) | session | No path under `server/src/modules/ci/`, `agent-runner/`, the CI Runs page, the agent CI tab, or `contracts/eval-ci.ts` |
| `server/` integration | `cd server && pnpm exec vitest run .it.test` | **user** | Green-run rule (`server/INSIGHTS.md`): a non-zero `skipped`, a non-zero exit, or a FAIL in an untouched file is **not** a pass. Until it runs, R5 (old route tests unmodified), R11's DB shape and R12–R14/R23 are **implemented but unverified** |
| e2e | `./scripts/e2e.sh` | **user** | The PR header changed and a nav section was added, so the seeded flows must pass (no flow references "Run review": `Grep` over `e2e/flows` found none) |
| pre-push | `/pr-self-review` | **user** | Manual-only; any `CRITICAL` blocks the PR |
| dev app | `./scripts/dev.sh`; open `/multi-agent-review`, a PR page, and a results page | **user** | Pages render (a value import or a Suspense problem shows only here or in `next build`, `client/INSIGHTS.md:83-89`); then M1 |

## Recommendations
Cuts are listed first. None of these is in `## Steps`.

| ID | Proposal | Why (`path:line`) | Cost if adopted (steps and files) | If declined |
|---|---|---|---|---|
| P1 | **Cut:** merge the two "latest" routes into `GET /multi-agent/latest?pr_id=` | Both return the same `MultiAgentRunRef` from the same query with an optional filter (S5 `latestMultiAgentRun(ws, prId?)` already takes one); spec `:69` lists two | −1 route, −1 hook, −1 `.it` case; spec amendment of AC-13 / `:69` | Two routes as planned; about 15 lines more |
| P2 | **Cut:** drop the per-run SSE subscription on the results page and rely on the 3 s poll | The results page shows no live log, so SSE only shortens "done" latency below 3 s. The NFR is 3 s (`:340`), which polling alone meets. AC-37 requires both | −1 hook use, −1 test assertion; spec amendment of AC-37 | As planned: SSE close triggers an immediate refetch |
| P3 | **Cut:** ship Columns only and drop the Tabs view | Tabs (AC-39) repeats the column data at a second density. It costs a component, a test file and keyboard tab semantics | −1 component folder, −1 test; amends a spec **Goal** (`:39`) and AC-39, so it goes to `spec-creator` | As planned |
| P4 | **Flag, more expensive than it looks:** replacing `RunReviewDropdown` removes "Run all enabled agents" and "run a *disabled* agent alone" from the PR page UI. The server keeps both (AC-5) | `RunReviewDropdown.tsx:52-77` lists every agent incl. disabled; AC-24 lists enabled only | 0 steps if accepted as is. Adding a "Select all" to the picker is ~1 control | A user who ran disabled agents from the PR page loses that path (they can still enable it) |
| P5 | **Flag:** the Configure run "PR picker" is per-repo (D8) | The PR list API is per repo (`core.ts:109`); a cross-repo picker needs a repo selector or a new endpoint | 0 (already the default) | — |
| P6 | **Addition (default declined):** move `FindingCard` to `client/src/components/finding-card/` like the drawer | See Q2 | 1 `git mv` + about 4 importers + test paths; widens the merge surface with worktree B | Cross-route import, documented in a comment |

## Clarification needed

**Blocked:** R13, R44 (both have workable defaults)

1. **R13 / AC-13: what do the "latest" routes return?** *Default:* a lightweight `{ run: MultiAgentRunRef | null }` (`{id, pr_id, pr_number, ran_at}`), wrapped like the existing `GET /pulls/:id/intent` → `{ intent }` (`reviews/routes.ts:36-39`). Both consumers need only the id, so no findings or groups are loaded for a link. *Cost of the other choice:* the full `MultiAgentRun` means a whole read plus grouping on every PR page view. A bare `null` body relies on how Fastify serialises a `null` return, which nothing in the repo exercises today.
2. **R39 / R41: where does the results page get `FindingCard`?** It lives in a route-private folder (`app/repos/[repoId]/pulls/[number]/_components/FindingCard`). Spec 0020's plan treated cross-route imports as a smell (0020 plan S16). *Default:* import it in place with a comment, which costs 0 moves and adds no merge surface with worktree B. *Cost of the other choice:* P6, a mechanical move of about 5 files, which is the consistent thing to do since the drawer moves for the same reason.
3. **R44 / AC-44: group/divergent counts for the 1-agent row.** AC-4 creates no multi-agent run for one agent, so there are no groups. *Default:* record "n/a — single-agent run has no multi-agent run (AC-4)". *Cost of the other choice:* computing groups for a single run needs a new code path for a measurement-only number.
4. **R1–R10, R15–R22: test file locations.** The spec's test plan puts four server tests under `server/src/modules/reviews/`. The repo has 92 server tests, all in `server/test/`, and none in `src`. *Default:* `server/test/` with the D5 name mapping, which `plan-verifier` should use when it reads the spec's test plan. *Cost of the other choice:* the first tests under `src/`, which the `pnpm arch` and lint configs were never shaped around.

**If you just say "go with the defaults":** I will issue this plan unchanged: ref-wrapped latest routes, `FindingCard` imported in place, "n/a" for the 1-agent group counts, and tests in `server/test/`.

## Out of scope
| Not in this plan | Why | Who owns it |
|---|---|---|
| A cancel control on the results page; a multi-run SSE stream; worktree-per-agent; text/semantic grouping; a Learn/Reply backend; persisting the selection | Spec non-goals `:48-59` | nobody / later specs |
| Any change under `server/src/modules/ci/**`, `agent-runner/**`, the CI Runs page, the agent CI tab, `contracts/eval-ci.ts` | C1, AC-43 | worktree B (`feat/export-to-ci`) |
| reviewer-core grounding or untrusted-input changes | Spec `:60-61`; AC-6 adds no prompt path | nobody |
| A client contract-parity test for these shapes | `cmp` covers the two identical files; no AC asks for one (simplicity) | — |
| The `.it.test` lane, e2e, `/pr-self-review`, M1's live run | The user's commands | **user** (M1: session + user) |
| `/code-review` and `test-writer` | Excluded for this run by the user (R46) | — |

## Not found
| Looked for | How (verbatim command) | Conclusion | What would settle it |
|---|---|---|---|
| Whether `reviewPullRequest` mutates the shared `diff` object (C27) | not opened (`reviewer-core/src`) | **inconclusive.** Concurrency safety under `allSettled` is assumed | Implementer #1 reads `reviewer-core/src` `reviewPullRequest` before S9 |
| Which `server/test` files hand-stub `AgentsRepository`/`ReviewRepository`/`Container` and would hit the new calls | `grep -rn "new ReviewService\|ReviewRunExecutor(" test/*.ts` (found only `run-executor-cancel.test.ts:157`) | **partial.** Cast stubs elsewhere were not enumerated | `Grep "as unknown as" server/test` (C8) |
| Whether any existing test sends `{agentId, all}` together, which AC-2 now rejects | `grep -rn "agentId.*all\|all: true" test/reviews.it.test.ts` (only `{all:true}` at `:370`) | **likely none** in that file; other files not searched | `Grep "agentId" server/test client/src` |
| A kit score-ring primitive, and a valid `IconName` for the nav item | not searched | **not chosen.** The implementer picks from `client/src/vendor/ui` | `Grep "export type IconName\|ScoreRing" client/src/vendor/ui` |
| Whether `FindingCard` renders rationale/suggestion through `react-markdown` (affects AC-42 beyond titles) | not opened past `FindingCard.tsx:31-53` | **inconclusive.** AC-42's tested case is the title | Read `FindingCard.tsx` fully. react-markdown without `rehype-raw` escapes raw HTML |
| How next-intl loads namespaces (whether a new `multiAgentReview.json` must be registered) | not opened | **inconclusive** | `Grep "messages/en" client/src` |
| `useFindingAction`'s exact input shape and invalidation keys | `grep -n "export function use" client/src/lib/hooks/reviews.ts` (`:158`) | Signature not read | Read `reviews.ts:158-186` |
| Whether `useSearchParams` on the static `/multi-agent-review` route is covered by `app/layout.tsx`'s Suspense at `next build` | `grep -rln "Suspense" client/src/app` (only `layout.tsx`) | **likely**, not proven | User's dev-app check, or a `pnpm build` (which corrupts a running `next dev`, `client/INSIGHTS.md:151-155`) |
| Whether `useActiveRepo` exists locally (upstream used it) | not searched | **inconclusive.** D8 needs an active repo | `Grep "useActiveRepo" client/src` |

## Execution mode
**Chosen by the user (relayed): 2 implementers, sequential, plus at most one fix-loop implementer.** My recommendation agrees. The client depends on #1's contracts and routes, the two packages share no file once S2 lands, and one context would otherwise have to hold drizzle migrations, the onion gates, Fastify, the App Router and RTL (about 9 skills).

**Multi-agent decomposition** (the base ref for every reviewer is **`origin/main`** = `c70c0e4`, never `HEAD`, per root `INSIGHTS.md:132`)
| Wave | Agent | Steps | Runs in parallel with | Handoff artifact |
|---|---|---|---|---|
| 1 | `implementer` #1 (server + both contract copies) | S1–S11 | — | Server typecheck + lint + unit green; `client` typecheck green; `0025_*` generated and migrated; `multi-agent.it.test.ts` written, **not run**; a report holding the final contract text, route table and stubs widened |
| 2 | `implementer` #2 (client) | S12–S22 | — | Client typecheck + lint + test green; one `RunTraceDrawer.tsx`; `RunReviewDropdown/` gone |
| 3 | **`plan-verifier`** (gate) | all S*, C*, V*, AC* | — | Present/Missing/Contradicted per item against this plan + spec. A `Missing` or `Contradicted` result goes to one fix-loop `implementer` (#3), then **one** re-verify. Wave 4 does not start until this is clean |
| 4 | `architecture-reviewer` | same diff vs `origin/main` | — | Layering verdict. Headline questions: D2 (read logic in `service.ts`, pure grouping file), C7, the cross-route `FindingCard` import (Q2). At most one fix iteration (#3), re-checked once |
| 5 | session + **user** | V-table user rows, M1 | — | `.it` lane, e2e, dev-app check, measurement recorded, `/pr-self-review` |

Sequential by construction: no two agents ever share the working directory at once (C25), and #2 never co-runs the client suite with anyone. Test ownership: each implementer writes only the tests its own steps name. There is no `test-writer`.

**Single-agent decomposition** (for reference only; not chosen): S1 → S11 → S12 → S22 in one context. Load `zod` + `typescript-expert` before S1; `postgresql-table-design` + `drizzle-orm-patterns` before S3; `onion-architecture` before S7; `fastify-best-practices` + `security` before S10; `react-code-organization` + `react-best-practices` + `next-best-practices` before S12; `react-testing-library` before S21.

**Cost of the chosen mode:** one hard handoff. If the contract block changes after #2 starts, both packages are touched again, so Q1 must be answered before wave 1. The client also has to wait for the whole server wave.

**The execution mode was set by the user before planning; the session should confirm Q1–Q4 before wave 1 starts.**
