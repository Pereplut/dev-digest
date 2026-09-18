# Findings counts

How the PR list's FINDINGS column is computed. Specs:
- [`specs/0002-findings-list-timeline.md`](../../specs/0002-findings-list-timeline.md)
- [`specs/0001-pr-list-cost-all-runs.md`](../specs/0001-pr-list-cost-all-runs.md), which switched the list to the latest single run

## Where findings live
- `findings.review_id` → `reviews.id`, and `reviews.run_id` → `agent_runs.id`.
  - `run_id` has no FK (added in migration `0008`).
  - Each done run writes one `kind='review'` review (`src/modules/reviews/run-executor.ts`).
- `severity` is plain text: `CRITICAL` / `WARNING` / `SUGGESTION`.
- There is no status column. Triage comes from `accepted_at` / `dismissed_at`; the UI calls dismissing "Reject".

## `GET /repos/:id/pulls` → `PrMeta.findings_counts`, `PrMeta.findings_run_id`
Computed on read in `src/modules/pulls/routes.ts`, because accepting or rejecting a finding changes the counts. No LLM is involved.

1. **Latest single run:** the newest `status='done'` run that has a `kind='review'` review.
   - Query: `SELECT DISTINCT ON (reviews.pr_id)` over `reviews ⋈ agent_runs`, ordered by `ran_at DESC, reviews.created_at DESC`.
   - A newer failed run doesn't replace it, and neither does a newer done run without a review.
2. **Counts:** one grouped query over `findings ⋈ reviews`, filtered on:
   - `reviews.run_id` = that run
   - `kind = 'review'`
   - `dismissed_at IS NULL`

   It groups by `(pr_id, severity)`, and `rollupSeverities` (`src/modules/pulls/status.ts`) tallies the rows into `{CRITICAL, WARNING, SUGGESTION}`.
3. **Values:**
   - `findings_counts` is `null` when the PR has no reviewed done run, and all zeros when that run has no open findings.
   - `findings_run_id` is that run's id. The client uses it to narrow `GET /pulls/:id/reviews` for the hover popover ("N findings in this run"), so the popover lists exactly what was counted.

**Indexes** (migration `0011`): `reviews_run_id_idx` and `findings_review_id_idx`. Postgres doesn't index foreign keys, and this query runs on every 60s list refetch.

**Seed:** in PR #482, the Security run is newer but has no review, so General is the latest run with a review: `{CRITICAL: 1, WARNING: 1}`, and the popover title is "2 FINDINGS IN THIS RUN".

## Things to know
- **One run only.** Findings from other agents' runs aren't in the list column. Open the PR's Agent runs tab to see them all.
- **Accepted findings count; rejected (dismissed) ones don't.**
- **Unlinked reviews are invisible here.** Reviews without a `run_id` (written before `0008`) can't be the latest run. SCORE (newest review) can still show.
- **Run-time counts can disagree.** `agent_runs.findings_count` and `blockers` are fixed when the run finishes, so after a rejection they can exceed the open counts.
- **Other surfaces count differently.** The Review runs pills count every card in the run, rejected ones included. See [client docs](../../client/docs/findings-ui.md).
