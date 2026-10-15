# Multi-Agent Review (client)

Shipped by [spec 0021](../../specs/0021-multi-agent-review.md); server side in
[`../../server/docs/multi-agent-review.md`](../../server/docs/multi-agent-review.md).

## Map
| Surface | Where | Notes |
|---|---|---|
| PR page run control | `src/app/repos/[repoId]/pulls/[number]/_components/AgentPicker` (replaces the deleted `RunReviewDropdown`) | Checkbox list of **enabled** agents with a `~Ns` hint or "no history", Select all / Clear, a "Configure agents" link. One POST with the checked ids: 1 id stays on the page (single run), 2+ navigate to the results page (`AgentPicker.tsx:1-4`). |
| Landing `/multi-agent-review` | `src/app/multi-agent-review/_components/MultiAgentLanding` | `?new=1` forces Configure run; otherwise redirects to the workspace's newest run, Configure run when none. A loading query renders a placeholder, never Configure run (`MultiAgentLanding.tsx:1-4`). |
| Configure run | `…/_components/ConfigureRun` | Pick a PR (active repo's list; `?pr=` preselects, even cross-repo, via the PR detail query) and agents. |
| Results `/multi-agent-review/[multiRunId]` | `…/_components/ResultsView` | Columns / Tabs toggle (`ColumnsView`, `TabsView`), `DisagreeBlock`, trace drawer driven by `?trace=<run_id>` (`ResultsView.tsx:68-73`). |
| Disagree block | `…/_components/DisagreeBlock` | One row per server group, one cell per `done` column; "only conflicts" filters on `divergent`. Model-written text is rendered as plain text children, never markdown or HTML (`DisagreeBlock.tsx:1-3`). |
| Sidebar | `src/vendor/ui/nav.ts` | A GLOBAL item `multi-agent` -> `/multi-agent-review`; no `gKey`, so the shortcut registry is untouched. This is the documented `nav.ts` exception in the root `AGENTS.md`. |

## Data fetching
- `useMultiAgentRun(id)` (`src/lib/hooks/multiAgentReview.ts`) polls `GET /multi-agent/:id` every
  `POLL_MS = 3000` while any column is `running`, then stops (`refetchInterval` is a pure function of the
  data, see `anyColumnRunning`).
- `ResultsView` also subscribes to the SSE stream of each running child (`useRunEvents`) and refetches
  once when the streams close, instead of waiting for the next poll (`ResultsView.tsx:30-40`). The poll
  is the safety net if a stream drops.
- `useLatestMultiAgentRun(prId?)`: key `["multi-agent-latest", prId ?? null]`. `undefined` is the
  workspace-wide run; `null` means "PR not known yet" and disables the query, so a PR page never
  falls back to another PR's run. `data.run === null` means none; a missing `data` means still loading.
- `useRunReview` invalidates the `["multi-agent-latest"]` prefix on success (`src/lib/hooks/reviews.ts:154-157`).

## Estimates
`src/lib/utils/multiAgentEstimate.ts`: "has history" is `est_duration_ms != null`. The fan-out summary
over the checked agents is the **max** duration (they run in parallel) and the null-safe **sum** of
costs; agents without history are excluded, and when none has history the summary is null and hidden.
The cost formatter is passed in because `lib/` does not import `components/run-cost-badge`.

## Shared pieces and one decision
- **Trace drawer** moved from the PR route's `_components/RunTraceDrawer` to
  `src/components/run-trace-drawer` (`git mv`, import paths only) so both the PR page and the results
  page open the same drawer. Exactly one `RunTraceDrawer.tsx` exists; `src/test/multi-agent-static.test.ts`
  guards it.
- **`FindingCard` is imported in place** from the PR route by
  `AttributedFinding.tsx:9-11`, not moved to `src/components`. Recorded decision (spec 0021 Q2): moving
  it would widen the merge surface with other open branches. Importing a route's private component from
  another route is therefore intentional; do not copy it. Learn / Reply render disabled (no backend).
