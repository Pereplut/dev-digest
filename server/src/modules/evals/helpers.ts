import type {
  AgentVersionConfig,
  EvalBatchRecord,
  EvalCase,
  EvalDashboard,
  EvalRunComparison,
  EvalRunRecord,
  EvalTrendPoint,
  IncomparableReason,
} from '@devdigest/shared';
import type { EvalCaseRow, EvalRunBatchRow, EvalRunRow } from '../../db/rows.js';
import { EVAL_ALERT_THRESHOLD, EVAL_KNOWN_METRICS_VERSION_FLOOR } from './constants.js';

/**
 * Pure helpers for the evals module (spec 0019): the batch rollup math and row
 * → DTO mapping. No DB, no container, no `this` — `pnpm arch`'s
 * `no-cross-module-internals` rule classifies by FILENAME, not behaviour (its
 * `to.path` only matches `(service|repository)`), so it cannot verify this
 * file stays pure. It earns the "helpers.ts" name by actually being pure
 * (server/INSIGHTS.md:472-478) — never add I/O, a repository call, or
 * `container` here.
 */

// ---- Batch rollup (AC-18, AC-19, AC-20, AC-65) -----------------------------

/**
 * One case's contribution to the batch rollup. All six metric fields are
 * carried as raw numerator/denominator counts, not ratios. `recall` and
 * `precision` are POOLED (`rollupBatch` sums numerators, sums denominators,
 * divides once — see `poolRatio`) rather than averaged per-case: in
 * production every case row carries exactly one expectation, so each of
 * `recallTotal`/`precisionAvoidedTotal` is always 0 or 1 and pooling never
 * weights one contributing case over another of the same kind — what it
 * buys is dropping the OPPOSITE case kind's vacuous `0/0` instead of
 * averaging a per-case `1` in for it, which is what let an unweighted mean
 * cancel a real regression (server/INSIGHTS.md 2026-10-07). `citationKept`/
 * `citationDropped` are AVERAGED instead (`meanRatio`), because that
 * denominator is a produced-finding count the model controls and does
 * differ in magnitude case to case — pooling it would make a case's batch
 * weight proportional to how many findings it happened to emit (security
 * finding, server/INSIGHTS.md 2026-10-07). A case that failed before scoring
 * (no model call, or a parse failure) has all six count fields `null`,
 * together with `pass`.
 *
 * `precisionAvoided`/`precisionAvoidedTotal` hold `reviewer-core`'s
 * `mustNotFlagAvoided`/`mustNotFlagTotal` (spec 0019 AC-13 amendment) —
 * `must_not_flag` expectations this case avoided over total `must_not_flag`
 * expectations for it. Deliberately NOT `scoreEvalCase`'s finding-denominated
 * `precisionCorrect`/`precisionTotal` (the per-case diagnostic persisted on
 * the `eval_runs` row, unaffected by this): both counts here come from the
 * database case rows, so this metric's batch weighting cannot be moved by
 * how many findings a model chose to emit — see `rollupBatch`'s doc comment
 * for why that matters and what finding-denominated pooling got wrong. A
 * `must_find` case contributes `0/0` here and is excluded by `poolRatio`,
 * exactly as a `must_not_flag` case contributes `0/0` to `recallMatched`/
 * `recallTotal` — each case kind drives exactly one metric.
 *
 * `citationKept`/`citationDropped` are the raw grounding counts for THIS
 * case only (never pooled across cases — see `rollupBatch`'s doc comment for
 * why `citationAccuracy` is averaged, not summed, at batch scope).
 */
export interface EvalCaseResult {
  pass: boolean | null;
  recallMatched: number | null;
  recallTotal: number | null;
  precisionAvoided: number | null;
  precisionAvoidedTotal: number | null;
  citationKept: number | null;
  citationDropped: number | null;
  /** USD cost of this one case's model call; `null` when unpriced. */
  costUsd: number | null;
}

export interface BatchRollup {
  casesTotal: number;
  casesPassed: number;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number;
  /** `null` if ANY case's cost is `null` — never a partial sum (AC-65). */
  costUsd: number | null;
}

/**
 * Pool a metric's per-case numerator/denominator pairs into one batch-level
 * ratio: sum every numerator, sum every denominator, divide once — never
 * average the per-case ratios (server/INSIGHTS.md 2026-10-07). A `null` pair
 * is a case that produced no counts for this metric (it failed before
 * scoring) and is excluded entirely. In production every case row carries
 * exactly one expectation, so `recall`'s and `precision`'s per-case
 * denominators are always 0 or 1 — pooling never weights one contributing
 * case more than another; what it buys is dropping the OPPOSITE case kind's
 * vacuous `0/0` instead of averaging a per-case `1` in for it (a
 * `must_not_flag` case contributes nothing to `recall`, and vice versa for
 * `precision` — see `rollupBatch`'s doc comment).
 *
 * Two null-adjacent outcomes are kept distinct on purpose:
 *  - no case contributed a pair at all → `null` — there is nothing to
 *    report.
 *  - at least one case contributed, but the pooled denominator is still 0
 *    (e.g. a batch of only `must_not_flag` cases pools a `recallTotal` of 0)
 *    → also `null`, NOT `1`. `scoreEvalCase`'s zero-denominator → `1`
 *    convention (AC-17) is a PER-CASE rule — "this one case had nothing to
 *    judge, so treat it as perfect" is reasonable for one row's diagnostic.
 *    At batch scope the same convention is a bug: every `must_find` case
 *    contributes `0/0` to `precision`, so an all-`must_find` batch — the
 *    default shape, since nothing requires a dismissed case — would report
 *    `precision: 1` however many false positives the model actually
 *    emitted. "This metric measured nothing" must render as nothing
 *    (`formatRatioTile`'s placeholder), never as "this metric is perfect".
 */
function poolRatio(pairs: ({ numerator: number; denominator: number } | null)[]): number | null {
  const present = pairs.filter((p): p is { numerator: number; denominator: number } => p !== null);
  if (present.length === 0) return null;
  const numerator = present.reduce((sum, p) => sum + p.numerator, 0);
  const denominator = present.reduce((sum, p) => sum + p.denominator, 0);
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * Average a metric's per-case ratios — one vote per database case row,
 * regardless of the size of either count behind it. Unlike `poolRatio`,
 * each case's ratio is computed FIRST (with `scoreEvalCase`'s own
 * zero-denominator → `1` convention, AC-17, so this matches the per-case
 * `citationAccuracy` already on each `eval_runs` row) and only then
 * averaged, so no case's weight depends on the size of its own denominator.
 *
 * `citationAccuracy` is the one batch metric this applies to. Its
 * denominator (`kept + dropped`) is a count of produced findings, which the
 * model controls, and nothing caps it — pooling it the way `recall` and
 * `precision` are pooled would let one case that happens to emit far more
 * findings than another outweigh it in the batch tile, however that case's
 * grounding actually went (one case at 1000 kept / 1000 total pools to
 * ~1.0 beside a second case at 0/50, regardless of the second case's 0%
 * accuracy). The mean gives both cases one vote each.
 */
function meanRatio(pairs: ({ numerator: number; denominator: number } | null)[]): number | null {
  const present = pairs.filter((p): p is { numerator: number; denominator: number } => p !== null);
  if (present.length === 0) return null;
  const ratios = present.map((p) => (p.denominator === 0 ? 1 : p.numerator / p.denominator));
  return ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
}

/**
 * Decimal sum with no binary-float accumulator: every cost is scaled to an
 * integer at 6 decimal places, summed as integers, then scaled back ONCE — the
 * only floating-point division in the whole function. `null` the moment any
 * case's cost is `null`: one unpriced model makes the whole batch's cost
 * unknown, not smaller (reviewer-core/INSIGHTS.md:9-15).
 */
function sumCostUsd(values: (number | null)[]): number | null {
  if (values.length === 0 || values.some((v) => v === null)) return null;
  const scaledSum = values.reduce<number>((sum, v) => sum + Math.round((v as number) * 1_000_000), 0);
  return scaledSum / 1_000_000;
}

/**
 * Roll up a batch's per-case results. `startedAtMs`/`nowMs` are plain numbers
 * (not an injected clock function) so a test can pin both ends directly
 * without faking a global timer.
 *
 * `recall` and `precision` each pool one case kind's expectation counts
 * (`must_find` for `recall`, `must_not_flag` for `precision` — see
 * `poolRatio`'s doc comment), so both batch denominators are counts of
 * database case rows and neither can be moved by how many findings a model
 * chose to emit. `citationAccuracy` is the one exception: it is AVERAGED
 * (`meanRatio`), never pooled, because its denominator (kept + dropped) is a
 * count of produced findings the model controls and nothing caps — pooling
 * it would make a case's batch weight proportional to how many findings it
 * happened to emit (see `meanRatio`'s doc comment).
 */
export function rollupBatch(cases: EvalCaseResult[], startedAtMs: number, nowMs: number): BatchRollup {
  return {
    casesTotal: cases.length,
    casesPassed: cases.filter((c) => c.pass === true).length,
    recall: poolRatio(
      cases.map((c) =>
        c.recallMatched === null || c.recallTotal === null
          ? null
          : { numerator: c.recallMatched, denominator: c.recallTotal },
      ),
    ),
    precision: poolRatio(
      cases.map((c) =>
        c.precisionAvoided === null || c.precisionAvoidedTotal === null
          ? null
          : { numerator: c.precisionAvoided, denominator: c.precisionAvoidedTotal },
      ),
    ),
    citationAccuracy: meanRatio(
      cases.map((c) =>
        c.citationKept === null || c.citationDropped === null
          ? null
          : { numerator: c.citationKept, denominator: c.citationKept + c.citationDropped },
      ),
    ),
    durationMs: nowMs - startedAtMs,
    costUsd: sumCostUsd(cases.map((c) => c.costUsd)),
  };
}

// ---- Row -> DTO mapping -----------------------------------------------------

export function toEvalCaseDto(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind as EvalCase['owner_kind'],
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles,
    input_meta: row.inputMeta,
    expected_output: row.expectedOutput,
    notes: row.notes,
    expectation_kind: row.expectationKind as EvalCase['expectation_kind'],
    expected_file: row.expectedFile,
    expected_start_line: row.expectedStartLine,
    expected_end_line: row.expectedEndLine,
    source_finding_id: row.sourceFindingId,
    created_at: row.createdAt.toISOString(),
  };
}

export function toEvalBatchRecordDto(row: EvalRunBatchRow): EvalBatchRecord {
  return {
    id: row.id,
    owner_kind: row.ownerKind as EvalBatchRecord['owner_kind'],
    owner_id: row.ownerId,
    agent_id: row.agentId,
    agent_version: row.agentVersion,
    ran_at: row.ranAt.toISOString(),
    status: row.status as EvalBatchRecord['status'],
    error: row.error,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    cases_total: row.casesTotal,
    cases_passed: row.casesPassed,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd == null ? null : Number(row.costUsd),
    metrics_version: row.metricsVersion,
  };
}

// ---- Dashboard + compare (spec 0020) ---------------------------------------

type MetricKey = 'recall' | 'precision' | 'citation_accuracy';

/** `metrics_version`-agnostic ratio delta: `null` the instant either operand is. */
function deltaOf(current: number | null, previous: number | null | undefined): number | null {
  if (current === null || previous === null || previous === undefined) return null;
  return current - previous;
}

function costOf(row: EvalRunBatchRow): number | null {
  return row.costUsd == null ? null : Number(row.costUsd);
}

/** Newest `ran_at` first — the ordering every dashboard/compare computation needs. */
function sortByRanAtDesc(rows: EvalRunBatchRow[]): EvalRunBatchRow[] {
  return [...rows].sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime());
}

/** AC-43's predicate, computed server-side too for AC-83's exclusion count. */
function hasAllMetrics(row: EvalRunBatchRow): boolean {
  return row.recall !== null && row.precision !== null && row.citationAccuracy !== null;
}

function toTrendPoint(row: EvalRunBatchRow): EvalTrendPoint {
  return {
    ran_at: row.ranAt.toISOString(),
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    // C22 — `cases_total` is NOT NULL and ≥ 1 for every batch that reached a
    // sweep (0019 AC-33 refuses an empty one); guarded anyway so this helper
    // never divides by zero or hands Zod a NaN.
    pass_rate: row.casesTotal > 0 ? row.casesPassed / row.casesTotal : 0,
    cost_usd: costOf(row),
  };
}

const ALERT_CODE: Record<MetricKey, string> = {
  recall: 'recall_drop',
  precision: 'precision_drop',
  citation_accuracy: 'citation_drop',
};

/** Tie order recall → precision → citation (R16) — iterate in that order and only replace on a STRICT improvement. */
const METRIC_ORDER: MetricKey[] = ['recall', 'precision', 'citation_accuracy'];

/**
 * AC-16/AC-84 — the lowest-delta metric's stable code once any delta reaches
 * `EVAL_ALERT_THRESHOLD`, tolerant of IEEE 754 error (`0.02 - 0.04 ===
 * -0.019999999999999997`) by a small epsilon rather than 4-dp rounding —
 * either satisfies AC-84; epsilon is cheaper here since every delta is
 * already a plain subtraction.
 */
function pickAlert(delta: Record<MetricKey, number | null>): string | null {
  let worst: { key: MetricKey; value: number } | null = null;
  for (const key of METRIC_ORDER) {
    const value = delta[key];
    if (value === null) continue;
    if (value > EVAL_ALERT_THRESHOLD + 1e-9) continue;
    if (worst === null || value < worst.value) worst = { key, value };
  }
  return worst ? ALERT_CODE[worst.key] : null;
}

/**
 * spec 0020 AC-24/AC-89/AC-90 (and, by the identical predicate, AC-13/AC-14's
 * dashboard delta/trend) — `metrics_version` is a RECORDED formula identity
 * only once it's `>= EVAL_KNOWN_METRICS_VERSION_FLOOR`. `1` is the value
 * AC-2's migration backfills onto every row that predates the
 * `metrics_version` column EXISTING at all — it means "formula unknown",
 * not "the old formula" — so it can never denote a known formula, including
 * against another row that also carries `1`.
 */
function isRecordedVersion(version: number): boolean {
  return version >= EVAL_KNOWN_METRICS_VERSION_FLOOR;
}

/**
 * ONE predicate for "these two batches' metrics are safe to put in the same
 * delta or trend" — shared by `buildDashboard`'s delta/trend computation AND
 * `buildComparison`, so the per-agent chart and the compare modal can never
 * disagree about which pairs are comparable. Equal AND both recorded; an
 * equal pair of UNRECORDED versions (`1 === 1`) is explicitly NOT comparable
 * — two unknowns are not known-equal.
 */
function comparableVersions(a: number, b: number): boolean {
  return isRecordedVersion(a) && isRecordedVersion(b) && a === b;
}

/**
 * Build the per-agent dashboard (AC-11 – AC-18, AC-83 – AC-85) from every
 * batch row the service has in hand — `trend_excluded` (AC-83) is computed
 * over ALL of `batches`, not just the slice the response returns in `trend`
 * or `recent_runs`. `owner_kind`/`owner_id` are left `null` here (this
 * function has no agent identity to assert) — the service sets them from the
 * request's own `:id`, never from a row.
 */
export function buildDashboard(batches: EvalRunBatchRow[], casesTotal: number): EvalDashboard {
  const doneDesc = sortByRanAtDesc(batches.filter((b) => b.status === 'done'));
  const current = doneDesc[0];

  if (!current) {
    // AC-18/AC-85: nothing measured yet — nulls throughout, traces 0/0, no alert.
    return {
      owner_kind: null,
      owner_id: null,
      cases_total: casesTotal,
      current: {
        recall: null,
        precision: null,
        citation_accuracy: null,
        traces_passed: 0,
        traces_total: 0,
        cost_usd: null,
      },
      delta: { recall: null, precision: null, citation_accuracy: null },
      trend: [],
      recent_runs: sortByRanAtDesc(batches).slice(0, 10).map(toEvalBatchRecordDto),
      alert: null,
      trend_excluded: { other_version: 0, incomplete_metrics: 0 },
    };
  }

  // AC-13/AC-14 (amended) — everyone who shares `comparableVersions` with
  // `current` (which excludes `current` itself when `current`'s OWN version
  // is unrecorded, since an unrecorded version isn't even comparable with
  // itself — "two unknowns are not known-equal"). This one filtered array
  // serves both the trend (includes `current`) and the delta's earlier-batch
  // lookup (excludes it) — the identical predicate AC-24 applies in the
  // compare route, so the chart and the modal can never disagree.
  const comparableToCurrentDesc = doneDesc.filter((b) =>
    comparableVersions(b.metricsVersion, current.metricsVersion),
  );

  // AC-13: the most recent EARLIER done batch comparable with `current`.
  const earlier = comparableToCurrentDesc.find((b) => b.id !== current.id);
  const delta: Record<MetricKey, number | null> = {
    recall: deltaOf(current.recall, earlier?.recall),
    precision: deltaOf(current.precision, earlier?.precision),
    citation_accuracy: deltaOf(current.citationAccuracy, earlier?.citationAccuracy),
  };

  // AC-14: ascending by ran_at, capped at the 20 most recent comparable with
  // `current` — includes points with a null metric (AC-43's drop is the
  // CLIENT's job; AC-5 made the point nullable exactly so this response can
  // still carry it). `current` stamped `1` (unrecorded) makes this empty —
  // nothing, not even `current` itself, is comparable with an unrecorded
  // stamp.
  const trend = comparableToCurrentDesc.slice(0, 20).map(toTrendPoint).reverse();

  // AC-83 (amended): `other_version` counts every done batch AC-14's
  // predicate excludes — a differing `metrics_version` OR an unrecorded one,
  // which for a `current` stamped `1` is every batch the agent has, since
  // `comparableToCurrentDesc` is then empty. `incomplete_metrics` only ever
  // counts WITHIN the comparable group, so the two counts never double-count
  // the same batch.
  const trendExcluded = {
    other_version: doneDesc.length - comparableToCurrentDesc.length,
    incomplete_metrics: comparableToCurrentDesc.filter((b) => !hasAllMetrics(b)).length,
  };

  return {
    owner_kind: null,
    owner_id: null,
    cases_total: casesTotal,
    current: {
      recall: current.recall,
      precision: current.precision,
      citation_accuracy: current.citationAccuracy,
      traces_passed: current.casesPassed,
      traces_total: current.casesTotal,
      cost_usd: costOf(current),
    },
    delta,
    trend,
    recent_runs: sortByRanAtDesc(batches).slice(0, 10).map(toEvalBatchRecordDto),
    alert: pickAlert(delta),
    trend_excluded: trendExcluded,
  };
}

/**
 * Build a two-batch comparison (AC-20, AC-24 – AC-26, AC-86). `old`/`new` are
 * resolved by `ran_at` regardless of which batch/config pair is passed first
 * (AC-20) — the caller (the service) need not sort before calling this.
 *
 * AC-24 (amended) — `comparable` is `comparableVersions(old, new)`: EQUAL
 * `metrics_version` AND that version naming a KNOWN formula
 * (`>= EVAL_KNOWN_METRICS_VERSION_FLOOR`). `1` means "formula unknown"
 * (AC-2's backfill value), not "the old formula" — two batches both stamped
 * `1` are NOT safely comparable with each other either, because "unknown"
 * is not a formula identity two rows can share. `incomparable_reason`
 * (AC-89/AC-90) distinguishes the two ways a pair can fail that test:
 * EITHER side unrecorded (AC-89 — including both unrecorded, and including
 * an unrecorded/recorded mismatch) outranks a genuine MISMATCH of two
 * recorded versions (AC-90) — "we don't know how this was computed" is a
 * different thing to tell a user than "these two were computed
 * differently".
 */
export function buildComparison(
  batchA: EvalRunBatchRow,
  configA: AgentVersionConfig | null,
  batchB: EvalRunBatchRow,
  configB: AgentVersionConfig | null,
): EvalRunComparison {
  const aIsOlder = batchA.ranAt.getTime() <= batchB.ranAt.getTime();
  const oldBatch = aIsOlder ? batchA : batchB;
  const oldConfig = aIsOlder ? configA : configB;
  const newBatch = aIsOlder ? batchB : batchA;
  const newConfig = aIsOlder ? configB : configA;

  const comparable = comparableVersions(oldBatch.metricsVersion, newBatch.metricsVersion);

  // AC-89/AC-90: EITHER side unrecorded → 'metrics_version_unrecorded',
  // INCLUDING when both carry the same unrecorded stamp (two `1`s are not
  // known-equal) and including an unrecorded/recorded MISMATCH (`1` vs `2`)
  // — "we don't know how this number was computed" outranks "these two were
  // computed differently". Only once BOTH sides are recorded (`>= floor`)
  // and they differ does it become a genuine 'metrics_version_mismatch'.
  let incomparableReason: IncomparableReason | null = null;
  if (!comparable) {
    const eitherUnrecorded =
      !isRecordedVersion(oldBatch.metricsVersion) || !isRecordedVersion(newBatch.metricsVersion);
    incomparableReason = eitherUnrecorded ? 'metrics_version_unrecorded' : 'metrics_version_mismatch';
  }

  return {
    old: toEvalBatchRecordDto(oldBatch),
    new: toEvalBatchRecordDto(newBatch),
    old_config: oldConfig,
    new_config: newConfig,
    comparable,
    incomparable_reason: incomparableReason,
    delta: {
      recall: comparable ? deltaOf(newBatch.recall, oldBatch.recall) : null,
      precision: comparable ? deltaOf(newBatch.precision, oldBatch.precision) : null,
      citation_accuracy: comparable ? deltaOf(newBatch.citationAccuracy, oldBatch.citationAccuracy) : null,
      // AC-25: cost never depends on the metrics formula, comparable or not.
      cost_usd: deltaOf(costOf(newBatch), costOf(oldBatch)),
    },
  };
}

export function toEvalRunRecordDto(row: EvalRunRow & { caseName?: string | null }): EvalRunRecord {
  return {
    id: row.id,
    case_id: row.caseId,
    case_name: row.caseName ?? null,
    ran_at: row.ranAt.toISOString(),
    actual_output: row.actualOutput,
    pass: row.pass,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd == null ? null : Number(row.costUsd),
  };
}
