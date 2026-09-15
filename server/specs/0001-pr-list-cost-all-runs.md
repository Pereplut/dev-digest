---
title: PR list cost of all runs, findings of the latest run
status: done  # draft | approved | in-progress | done
lesson: L01
packages: [server]
parent: specs/0003-hw-validation-alignment.md
---

## Problem
The server already provides the PR list's COST and FINDINGS values, but it computes both over the
"latest review round" (each agent's newest done run). The homework asks for different values:
- **Criterion 12:** COST is the sum of **all successful runs**.
- **Criterion 20:** the popover is titled "N findings **in this run**", which needs a single run.

## Scope / non-goals
- **In scope:**
  - The `GET /repos/:id/pulls` aggregates.
  - The `PrMeta` contract, in both vendored copies.
  - The integration tests and server docs.
- **Non-goals:**
  - Per-run cost, which is already correct.
  - The per-run endpoint `GET /pulls/:id/runs`.
  - Caching or denormalizing counts.

## Design
- **COST:** `GROUP BY pr_id` over `agent_runs WHERE status='done'`, selecting `sum(cost_usd)`, `count(*)` and `count(cost_usd)`.
  - `cost_complete = priced === runs`.
  - Runs whose agent was deleted (`agent_id` NULL) are included.
- **FINDINGS run:** `DISTINCT ON (reviews.pr_id)` over `reviews ⋈ agent_runs` with `kind='review'` and `status='done'`, ordered by `ran_at DESC`.
- **Counts:** the existing grouped query, narrowed to that run (dismissed findings excluded), then `rollupSeverities`.
- **Contract:** `PrMeta.findings_round_run_ids: string[]` is replaced by `findings_run_id: string`. The only consumer is the client, which changes in the same PR.

## Acceptance criteria
- [x] Seeded #482: `cost_usd = 0.016`, and `cost_complete = true`.
- [x] Cost responds correctly to new runs:
  - a re-run adds its cost
  - a failed run is ignored
  - an unpriced done run sets `cost_complete=false`
  - a null-agent done run counts
- [x] A PR without runs gets `null` for cost and counts.
- [x] Seeded #482: `findings_run_id` is the General run, with counts `{1,1,0}`.
- [x] A newer failed run, or a newer done run without a review, doesn't change the run.
- [x] A newer reviewed run replaces the old one; only its open findings count, and summary reviews are ignored.

## Test plan
- `server/test/integration.it.test.ts`: the "sums the cost of all done runs" and "open finding counts of the latest run with a review" tests.
- `server/test/contracts.test.ts`: `PrMeta` with `findings_run_id`.
- e2e flow 02 checks `$0.016` and "2 FINDINGS IN THIS RUN".

## Phases
| Phase | Date | Note |
|---|---|---|
| Initiation | 2026-09-15 | Audit: COST used the latest round (`routes.ts` DISTINCT ON pr+agent) |
| Planning | 2026-09-15 | User chose the latest single run for FINDINGS |
| Implementation | 2026-09-15 | `routes.ts`, contract, tests, docs |
| Validation | 2026-09-15 | typecheck ✓, unit 103/103 ✓, integration 30/30 ✓ |
| Completion | 2026-09-15 | `docs/run-cost.md` + `docs/findings-counts.md` rewritten; manual: API cost = SQL `sum(cost_usd)` of done runs for dev PRs #1–#4; server INSIGHTS "Supersedes" entry |
