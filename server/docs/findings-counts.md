# Findings counts

How the PR list's FINDINGS column is computed. Spec:
[`specs/0002-findings-list-timeline.md`](../../specs/0002-findings-list-timeline.md).

## Where findings live
- `findings.review_id` → `reviews.id`, and `reviews.run_id` → `agent_runs.id`.
  - `run_id` has no FK (added in migration `0008`).
  - Each done run writes one `kind='review'` review (`src/modules/reviews/run-executor.ts`).
- `severity` is plain text: `CRITICAL` / `WARNING` / `SUGGESTION`.
- There is no status column. Triage comes from `accepted_at` / `dismissed_at`.

## `GET /repos/:id/pulls` → `PrMeta.findings_counts`, `PrMeta.findings_round_run_ids`
Computed on read in `src/modules/pulls/routes.ts`, because accepting or dismissing a finding changes the counts:
1. **Round:** each agent's newest `status='done'` run. This is the same `DISTINCT ON (pr_id, agent_id)` query that sums COST ([`run-cost.md`](run-cost.md)).
2. **Counts:** one grouped query, `findings ⋈ reviews` where:
   - `reviews.run_id` is in the round
   - `kind = 'review'`
   - `dismissed_at IS NULL`
   
   It is grouped by `(pr_id, severity)` and tallied into `{CRITICAL, WARNING, SUGGESTION}` by `rollupSeverities` (`src/modules/pulls/status.ts`).
3. **Values:**
   - `findings_counts` is `null` when the PR has no done run, and all-zero when the round found nothing.
   - `findings_round_run_ids` lists the round's runs. The client uses it to filter `GET /pulls/:id/reviews` for the hover popover, so the popover lists exactly what was counted.

**Indexes** (migration `0011`): `reviews_run_id_idx` and `findings_review_id_idx`. Postgres doesn't index foreign keys, and this runs on every 60s list refetch.

## Things to know
- **Duplicates across agents are not merged.** Two agents flagging one issue count twice.
- **Accepted findings count; dismissed ones don't.**
- **Unlinked reviews count 0.** Reviews without `run_id` (written before `0008`) and done runs without a review add nothing, while SCORE (newest review) can still show. There is no backfill.
- **Run-time counts can disagree.** `agent_runs.findings_count` and `blockers` are fixed when the run finishes, so they can exceed the open counts after a dismissal.
