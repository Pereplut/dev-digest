/**
 * Fixed task line sent with every eval-case replay (spec 0019). It carries no
 * interpolated value at all — a case's `name`/`notes` are never prompted
 * (spec 0019 "Untrusted inputs": rendered as text in the Evals tab only) — so
 * there is nothing here needing the untrusted-content wrapper, and this file is not
 * "prompt assembly" (AC-47): the diff itself still reaches the model only
 * through `reviewPullRequest`'s own assembler.
 */
export const EVAL_TASK_LINE =
  'Review this diff. Report only the distinct, high-value findings you can defend, each citing ' +
  'an exact file and line range that appears in the diff. There is no target or maximum count, ' +
  'and zero findings is a valid result — do not pad or repeat to reach a number.';

/** Reason recorded on every batch the boot reap fails (AC-72), matching the review-runs reaper. */
export const EVAL_REAP_ERROR = 'Orphaned by an API restart (reaped on boot)';

/**
 * spec 0020 (AC-1 – AC-3) — the rollup formula version stamped on every NEW
 * `eval_run_batches` row by `EvalService.queueBatch`. Bump this the moment
 * `helpers.ts`'s `rollupBatch` (or either combinator it calls, `poolRatio`/
 * `meanRatio`) changes in a way that makes an old batch's `recall`/
 * `precision`/`citation_accuracy` formula-incomparable with a new one — that
 * bump IS the one-line review target AC-3 asks for; nothing at runtime
 * verifies the pairing (spec 0020 `## Non-functional`, "what the stamp cannot
 * do").
 *
 * Version 1 — pre-2026-10-08: unweighted mean-of-per-case `recall`/
 * `precision`, finding-denominated `precision` (server/INSIGHTS.md
 * 2026-10-07, "An unweighted mean of per-case precisions cancels a real
 * regression").
 * Version 2 (current) — `recall`/`precision` POOLED over database
 * case-expectation counts (`poolRatio`); `citation_accuracy` stays a
 * per-case MEAN (`meanRatio`) because its denominator is a model-controlled
 * produced-finding count (server/INSIGHTS.md 2026-10-08).
 *
 * The schema default in `db/schema/eval.ts` is a LITERAL `2`, not an import
 * of this constant (spec 0020 `## Decisions I settled` #4) — `db/schema/**`
 * must not depend on `modules/**`. `eval-metrics-version.test.ts` pins the
 * two together with a hermetic `getTableConfig` assertion.
 */
export const EVAL_METRICS_VERSION = 2;

/**
 * spec 0020 AC-24 (amended, found against the live dev DB 2026-10-08) — the
 * lowest `metrics_version` that names a KNOWN rollup formula.
 *
 * `1` is not "the pre-2026-10-08 formula" — it is the value AC-2's migration
 * backfills onto every row that predates the `metrics_version` column
 * EXISTING at all, which means "formula unknown", not "formula known to be
 * the old one". Two batches both stamped `1` can in fact have been computed
 * by different code (an old-formula run and, on the dev DB, a run made
 * AFTER the formula change but BEFORE this migration landed — see
 * server/INSIGHTS.md 2026-10-08, "The dev DB had 8 pre-migration batches...").
 * Equal-and-unknown is not known-equal, so `buildComparison` requires BOTH
 * `old.metrics_version === new.metrics_version` AND
 * `metrics_version >= EVAL_KNOWN_METRICS_VERSION_FLOOR` before setting
 * `comparable: true` — a batch stamped `1` is incomparable with everything,
 * including another batch stamped `1`.
 */
export const EVAL_KNOWN_METRICS_VERSION_FLOOR = 2;

/**
 * spec 0020 AC-16 — a delta at or below this (with AC-84's float tolerance)
 * sets the dashboard's `alert`. Fixed per `## Decisions` in the governing
 * spec: no settings surface, no contract field, change it in code if it ever
 * needs to move.
 */
export const EVAL_ALERT_THRESHOLD = -0.02;
