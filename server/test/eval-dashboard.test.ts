import { describe, it, expect } from 'vitest';
import { buildComparison, buildDashboard } from '../src/modules/evals/helpers.js';
import type { EvalRunBatchRow } from '../src/db/rows.js';
import type { AgentVersionConfig } from '@devdigest/shared';
import { EvalDashboard, EvalRunComparison } from '@devdigest/shared';

/**
 * Spec 0020 S7 — the pure dashboard/compare helpers (R12 – R18, R20, R24,
 * R25, R47/AC-83). No DB, no container — `buildDashboard`/`buildComparison`
 * take rows directly.
 */

let seq = 0;
function makeBatch(overrides: Partial<EvalRunBatchRow> = {}): EvalRunBatchRow {
  seq += 1;
  return {
    id: `batch-${seq}`,
    workspaceId: 'ws1',
    ownerKind: 'agent',
    ownerId: 'agent1',
    agentId: 'agent1',
    agentVersion: 1,
    // seq-based offset rather than a day-of-month string — the latter
    // overflows past day 31 once enough fixtures are built in one test file.
    ranAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)),
    status: 'done',
    error: null,
    recall: 0.5,
    precision: 0.5,
    citationAccuracy: 0.9,
    casesTotal: 4,
    casesPassed: 2,
    durationMs: 1000,
    costUsd: '0.001',
    metricsVersion: 2,
    ...overrides,
  } as EvalRunBatchRow;
}

describe('buildDashboard (spec 0020)', () => {
  it('AC-12: current comes from the newest done batch; traces_* from cases_passed/cases_total', () => {
    const older = makeBatch({ ranAt: new Date('2026-01-01T00:00:00.000Z'), recall: 0.3 });
    const newer = makeBatch({
      ranAt: new Date('2026-01-05T00:00:00.000Z'),
      recall: 0.8,
      casesPassed: 3,
      casesTotal: 5,
    });
    const dashboard = buildDashboard([older, newer], 5);
    expect(dashboard.current.recall).toBe(0.8);
    expect(dashboard.current.traces_passed).toBe(3);
    expect(dashboard.current.traces_total).toBe(5);
  });

  it('AC-13/AC-14: three same-version done batches — each delta is newest minus the one before it; trend is all three ascending', () => {
    const b1 = makeBatch({ ranAt: new Date('2026-01-01T00:00:00.000Z'), recall: 0.3, precision: 0.4, citationAccuracy: 0.5 });
    const b2 = makeBatch({ ranAt: new Date('2026-01-02T00:00:00.000Z'), recall: 0.5, precision: 0.6, citationAccuracy: 0.7 });
    const b3 = makeBatch({ ranAt: new Date('2026-01-03T00:00:00.000Z'), recall: 0.6, precision: 0.5, citationAccuracy: 0.9 });
    const dashboard = buildDashboard([b1, b2, b3], 3);
    expect(dashboard.delta.recall).toBeCloseTo(0.1);
    expect(dashboard.delta.precision).toBeCloseTo(-0.1);
    expect(dashboard.delta.citation_accuracy).toBeCloseTo(0.2);
    expect(dashboard.trend.map((p) => p.ran_at)).toEqual([
      b1.ranAt.toISOString(),
      b2.ranAt.toISOString(),
      b3.ranAt.toISOString(),
    ]);
    // Negative control: a real, non-null delta — a helper that unconditionally
    // returned null would fail this.
    expect(dashboard.delta.recall).not.toBeNull();
  });

  it('AC-13/AC-17: a newest batch of a different metrics_version than its history — deltas null, trend holds ONLY the newest version\'s points', () => {
    const v1a = makeBatch({ ranAt: new Date('2026-01-01T00:00:00.000Z'), metricsVersion: 1 });
    const v1b = makeBatch({ ranAt: new Date('2026-01-02T00:00:00.000Z'), metricsVersion: 1 });
    const v2 = makeBatch({ ranAt: new Date('2026-01-03T00:00:00.000Z'), metricsVersion: 2 });
    const dashboard = buildDashboard([v1a, v1b, v2], 3);
    expect(dashboard.delta).toEqual({ recall: null, precision: null, citation_accuracy: null });
    expect(dashboard.trend).toHaveLength(1);
    expect(dashboard.trend[0]!.ran_at).toBe(v2.ranAt.toISOString());
  });

  it('AC-14: 25 same-version done batches — trend holds the 20 most recent', () => {
    const batches = Array.from({ length: 25 }, (_, i) =>
      makeBatch({ ranAt: new Date(Date.UTC(2026, 0, i + 1)) }),
    );
    const dashboard = buildDashboard(batches, 25);
    expect(dashboard.trend).toHaveLength(20);
    // Ascending, and the oldest 5 were dropped — the earliest point left is day 6.
    expect(dashboard.trend[0]!.ran_at).toBe(new Date(Date.UTC(2026, 0, 6)).toISOString());
    expect(dashboard.trend.at(-1)!.ran_at).toBe(new Date(Date.UTC(2026, 0, 25)).toISOString());
  });

  it('AC-17: a current with precision null — that delta is null while the other two are numbers', () => {
    const older = makeBatch({ ranAt: new Date('2026-01-01T00:00:00.000Z'), recall: 0.3, precision: 0.4, citationAccuracy: 0.5 });
    const newer = makeBatch({
      ranAt: new Date('2026-01-02T00:00:00.000Z'),
      recall: 0.5,
      precision: null,
      citationAccuracy: 0.7,
    });
    const dashboard = buildDashboard([older, newer], 2);
    expect(dashboard.delta.precision).toBeNull();
    expect(dashboard.delta.recall).not.toBeNull();
    expect(dashboard.delta.citation_accuracy).not.toBeNull();
  });

  it('AC-17: a single done batch — every delta is null (no earlier batch to diff against)', () => {
    const only = makeBatch();
    const dashboard = buildDashboard([only], 1);
    expect(dashboard.delta).toEqual({ recall: null, precision: null, citation_accuracy: null });
  });

  it('AC-18/AC-85: no done batch at all — every nullable metric null, trend empty, traces_* exactly 0 (not null)', () => {
    const cancelled = makeBatch({ status: 'cancelled' });
    const dashboard = buildDashboard([cancelled], 3);
    expect(dashboard.current).toEqual({
      recall: null,
      precision: null,
      citation_accuracy: null,
      traces_passed: 0,
      traces_total: 0,
      cost_usd: null,
    });
    expect(dashboard.current.traces_passed).toBe(0);
    expect(dashboard.current.traces_total).toBe(0);
    expect(dashboard.trend).toEqual([]);
    expect(dashboard.alert).toBeNull();
    expect(dashboard.cases_total).toBe(3);
    // Negative control: the same agent after one done batch returns numbers.
    const withDone = buildDashboard([cancelled, makeBatch()], 3);
    expect(withDone.current.recall).not.toBeNull();
  });

  it('AC-15: recent_runs is the 10 most recent batches of ANY status, newest first', () => {
    const batches = [
      ...Array.from({ length: 8 }, (_, i) => makeBatch({ ranAt: new Date(Date.UTC(2026, 0, i + 1)) })),
      makeBatch({ ranAt: new Date(Date.UTC(2026, 0, 20)), status: 'failed' }),
      makeBatch({ ranAt: new Date(Date.UTC(2026, 0, 21)), status: 'running' }),
      makeBatch({ ranAt: new Date(Date.UTC(2026, 0, 22)), status: 'cancelled' }),
    ];
    const dashboard = buildDashboard(batches, batches.length);
    expect(dashboard.recent_runs).toHaveLength(10);
    expect(dashboard.recent_runs[0]!.status).toBe('cancelled');
    expect(dashboard.recent_runs.map((r) => r.ran_at)).toEqual(
      [...dashboard.recent_runs.map((r) => r.ran_at)].sort().reverse(),
    );
  });

  it('AC-16: delta of exactly -0.02 alerts precision_drop (boundary inclusive); -0.019 does not; two below picks the LOWER; all positive → null; all null → null', () => {
    const base = { ran_at: new Date('2026-01-01T00:00:00.000Z') };
    function dashboardFor(prevP: number, currP: number): string | null {
      const older = makeBatch({ ranAt: base.ran_at, recall: 0.9, precision: prevP, citationAccuracy: 0.9 });
      const newer = makeBatch({
        ranAt: new Date('2026-01-02T00:00:00.000Z'),
        recall: 0.9,
        precision: currP,
        citationAccuracy: 0.9,
      });
      return buildDashboard([older, newer], 2).alert;
    }
    expect(dashboardFor(0.5, 0.48)).toBe('precision_drop'); // exactly -0.02
    expect(dashboardFor(0.5, 0.481)).toBeNull(); // -0.019

    // Two metrics below threshold → the code of the LOWER (more negative) one.
    const olderTwo = makeBatch({ ranAt: base.ran_at, recall: 0.9, precision: 0.9, citationAccuracy: 0.9 });
    const newerTwo = makeBatch({
      ranAt: new Date('2026-01-02T00:00:00.000Z'),
      recall: 0.85, // -0.05
      precision: 0.8, // -0.10 — lower
      citationAccuracy: 0.9,
    });
    expect(buildDashboard([olderTwo, newerTwo], 2).alert).toBe('precision_drop');

    // All positive deltas → null.
    const olderUp = makeBatch({ ranAt: base.ran_at, recall: 0.5, precision: 0.5, citationAccuracy: 0.5 });
    const newerUp = makeBatch({
      ranAt: new Date('2026-01-02T00:00:00.000Z'),
      recall: 0.6,
      precision: 0.6,
      citationAccuracy: 0.6,
    });
    expect(buildDashboard([olderUp, newerUp], 2).alert).toBeNull();

    // Every delta null (single batch, nothing to diff) → null.
    expect(buildDashboard([makeBatch()], 1).alert).toBeNull();
  });

  it('AC-84: the threshold tolerates IEEE 754 error — a delta computed from 0.02 vs 0.04 (not a literal) still alerts; 0.02 vs 0.039 does not', () => {
    const older = makeBatch({ ranAt: new Date('2026-01-01T00:00:00.000Z'), recall: 0.9, precision: 0.04, citationAccuracy: 0.9 });
    const newer = makeBatch({
      ranAt: new Date('2026-01-02T00:00:00.000Z'),
      recall: 0.9,
      precision: 0.02, // computed delta: 0.02 - 0.04 === -0.019999999999999997
      citationAccuracy: 0.9,
    });
    const dashboard = buildDashboard([older, newer], 2);
    expect(dashboard.delta.precision).toBeCloseTo(-0.02);
    expect(dashboard.alert).toBe('precision_drop');

    // Negative control — a genuine 1.9pt drop must NOT be swallowed by the tolerance.
    const olderNeg = makeBatch({ ranAt: new Date('2026-01-01T00:00:00.000Z'), recall: 0.9, precision: 0.039, citationAccuracy: 0.9 });
    const newerNeg = makeBatch({
      ranAt: new Date('2026-01-02T00:00:00.000Z'),
      recall: 0.9,
      precision: 0.02,
      citationAccuracy: 0.9,
    });
    expect(buildDashboard([olderNeg, newerNeg], 2).alert).toBeNull();
  });

  it('AC-83: both exclusion counts computed over EVERY batch of the agent, not only trend/recent_runs — fixture deliberately exceeds both caps', () => {
    // 9 done batches of the current version, 2 with an incomplete metric
    // triple, plus 5 done batches of an older version, plus a cancelled and
    // a failed batch (counted in neither). 16 total — exceeds recent_runs'
    // 10-row cap and trend's own 20-cap is not the limiting factor here, but
    // the counts must still be right over all 16, not derivable from the
    // capped arrays.
    const currentVersionDone = Array.from({ length: 9 }, (_, i) =>
      makeBatch({
        ranAt: new Date(Date.UTC(2026, 1, i + 1)),
        metricsVersion: 2,
        ...(i < 2 ? { precision: null } : {}),
      }),
    );
    const olderVersionDone = Array.from({ length: 5 }, (_, i) =>
      makeBatch({ ranAt: new Date(Date.UTC(2026, 0, i + 1)), metricsVersion: 1 }),
    );
    const cancelled = makeBatch({ ranAt: new Date(Date.UTC(2026, 1, 20)), status: 'cancelled', metricsVersion: 2 });
    const failed = makeBatch({ ranAt: new Date(Date.UTC(2026, 1, 21)), status: 'failed', metricsVersion: 2 });
    const batches = [...currentVersionDone, ...olderVersionDone, cancelled, failed];

    const dashboard = buildDashboard(batches, batches.length);
    // trend itself still carries all 9 same-version done points (including
    // the 2 with a null metric) — AC-43's drop is the CLIENT's job; the
    // server's exclusion COUNT is the thing under test here.
    expect(dashboard.trend).toHaveLength(9);
    expect(dashboard.trend_excluded).toEqual({ other_version: 5, incomplete_metrics: 2 });
  });

  /**
   * AC-13/AC-14/AC-83 (amended) — the dashboard half of the same defect
   * AC-24/AC-89 fix in the compare route. `metrics_version: 1` means
   * "formula unknown", so an agent whose every batch is stamped `1` has
   * nothing comparable with anything, including with itself: every delta is
   * `null`, the trend is empty (not "one point", `current` included), and
   * EVERY done batch counts as excluded under `other_version` — none of
   * them land in `incomplete_metrics`, which only counts WITHIN the
   * comparable-with-current group.
   */
  it('AC-13/AC-14/AC-83 (amended): an agent whose batches are ALL metrics_version 1 — every delta null, trend empty, other_version equals the full count', () => {
    const batches = Array.from({ length: 4 }, (_, i) =>
      makeBatch({ ranAt: new Date(Date.UTC(2026, 0, i + 1)), metricsVersion: 1 }),
    );
    const dashboard = buildDashboard(batches, batches.length);
    expect(dashboard.delta).toEqual({ recall: null, precision: null, citation_accuracy: null });
    expect(dashboard.alert).toBeNull();
    expect(dashboard.trend).toEqual([]);
    expect(dashboard.trend_excluded).toEqual({ other_version: 4, incomplete_metrics: 0 });
    // The current TILE itself still renders real numbers — it's the DELTA
    // and TREND that go empty, never the latest batch's own stored values.
    expect(dashboard.current.recall).not.toBeNull();
  });

  /**
   * Positive control for the same amendment: two RECORDED (>= 2) batches
   * must still produce a real delta and a two-point trend, so the fix for
   * the all-unrecorded case above does not degenerate into "the dashboard
   * never shows anything".
   */
  it('positive control: two recorded version-2 batches still produce a real delta and a two-point trend', () => {
    const older = makeBatch({ ranAt: new Date('2026-01-01T00:00:00.000Z'), metricsVersion: 2, recall: 0.4 });
    const newer = makeBatch({ ranAt: new Date('2026-01-02T00:00:00.000Z'), metricsVersion: 2, recall: 0.6 });
    const dashboard = buildDashboard([older, newer], 2);
    expect(dashboard.delta.recall).toBeCloseTo(0.2);
    expect(dashboard.trend).toHaveLength(2);
  });
});

describe('buildComparison (spec 0020)', () => {
  it('AC-20: old/new resolve by ran_at regardless of argument order', () => {
    const early = makeBatch({ ranAt: new Date('2026-01-01T00:00:00.000Z') });
    const late = makeBatch({ ranAt: new Date('2026-01-05T00:00:00.000Z') });
    const forward = buildComparison(early, null, late, null);
    const backward = buildComparison(late, null, early, null);
    expect(forward.old.id).toBe(early.id);
    expect(forward.new.id).toBe(late.id);
    expect(backward.old.id).toBe(early.id);
    expect(backward.new.id).toBe(late.id);
  });

  it('AC-24/AC-25: a metrics_version mismatch sets comparable false, withholds the three metric deltas, but still computes cost_usd', () => {
    const older = makeBatch({ ranAt: new Date('2026-01-01T00:00:00.000Z'), metricsVersion: 1, costUsd: '0.01' });
    const newer = makeBatch({ ranAt: new Date('2026-01-02T00:00:00.000Z'), metricsVersion: 2, costUsd: '0.03' });
    const comparison = buildComparison(older, null, newer, null);
    expect(comparison.comparable).toBe(false);
    expect(comparison.incomparable_reason).not.toBeNull();
    expect(comparison.delta.recall).toBeNull();
    expect(comparison.delta.precision).toBeNull();
    expect(comparison.delta.citation_accuracy).toBeNull();
    expect(comparison.delta.cost_usd).toBeCloseTo(0.02);

    // Positive control: same version → comparable and all four deltas numeric.
    const sameA = makeBatch({ ranAt: new Date('2026-01-01T00:00:00.000Z'), metricsVersion: 2 });
    const sameB = makeBatch({ ranAt: new Date('2026-01-02T00:00:00.000Z'), metricsVersion: 2 });
    const comparable = buildComparison(sameA, null, sameB, null);
    expect(comparable.comparable).toBe(true);
    expect(comparable.incomparable_reason).toBeNull();
    for (const key of ['recall', 'precision', 'citation_accuracy', 'cost_usd'] as const) {
      expect(comparable.delta[key]).not.toBeNull();
    }
  });

  /**
   * AC-24 amendment (found against the live dev DB 2026-10-08) —
   * `metrics_version: 1` means "formula unknown" (AC-2's backfill value),
   * not "the pre-2026-10-08 formula". Two batches BOTH stamped 1 are
   * therefore NOT comparable with each other either.
   */
  it('AC-24 (amended): two version-1 batches are incomparable — the legacy reason, distinct from a mismatch', () => {
    const a = makeBatch({ ranAt: new Date('2026-01-01T00:00:00.000Z'), metricsVersion: 1 });
    const b = makeBatch({ ranAt: new Date('2026-01-02T00:00:00.000Z'), metricsVersion: 1 });
    const comparison = buildComparison(a, null, b, null);
    expect(comparison.comparable).toBe(false);
    expect(comparison.incomparable_reason).toBe('metrics_version_unrecorded');
  });

  it('AC-89: version-1 vs version-2 is incomparable for the UNRECORDED reason — an unrecorded side outranks a mere mismatch', () => {
    const a = makeBatch({ ranAt: new Date('2026-01-01T00:00:00.000Z'), metricsVersion: 1 });
    const b = makeBatch({ ranAt: new Date('2026-01-02T00:00:00.000Z'), metricsVersion: 2 });
    const comparison = buildComparison(a, null, b, null);
    expect(comparison.comparable).toBe(false);
    expect(comparison.incomparable_reason).toBe('metrics_version_unrecorded');
  });

  it('AC-90: two DIFFERING but BOTH-recorded versions (2 vs 3) is the genuine MISMATCH reason, distinct from AC-89\'s unrecorded code', () => {
    const a = makeBatch({ ranAt: new Date('2026-01-01T00:00:00.000Z'), metricsVersion: 2 });
    const b = makeBatch({ ranAt: new Date('2026-01-02T00:00:00.000Z'), metricsVersion: 3 });
    const comparison = buildComparison(a, null, b, null);
    expect(comparison.comparable).toBe(false);
    expect(comparison.incomparable_reason).toBe('metrics_version_mismatch');
    expect(comparison.incomparable_reason).not.toBe('metrics_version_unrecorded');
  });

  it('AC-24 (amended) positive control: two version-2 batches ARE comparable', () => {
    const a = makeBatch({ ranAt: new Date('2026-01-01T00:00:00.000Z'), metricsVersion: 2 });
    const b = makeBatch({ ranAt: new Date('2026-01-02T00:00:00.000Z'), metricsVersion: 2 });
    const comparison = buildComparison(a, null, b, null);
    expect(comparison.comparable).toBe(true);
    expect(comparison.incomparable_reason).toBeNull();
  });

  it('AC-24/AC-25 (amended): while incomparable for the LEGACY reason, the three metric deltas are null and cost_usd is still a number', () => {
    const a = makeBatch({ ranAt: new Date('2026-01-01T00:00:00.000Z'), metricsVersion: 1, costUsd: '0.01' });
    const b = makeBatch({ ranAt: new Date('2026-01-02T00:00:00.000Z'), metricsVersion: 1, costUsd: '0.04' });
    const comparison = buildComparison(a, null, b, null);
    expect(comparison.incomparable_reason).toBe('metrics_version_unrecorded');
    expect(comparison.delta.recall).toBeNull();
    expect(comparison.delta.precision).toBeNull();
    expect(comparison.delta.citation_accuracy).toBeNull();
    expect(comparison.delta.cost_usd).toBeCloseTo(0.03);
  });

  it('carries configs through untouched (AC-26)', () => {
    const cfg: AgentVersionConfig = {
      provider: 'openai',
      model: 'gpt-4.1',
      system_prompt: 'review',
      strategy: 'single-pass',
      ci_fail_on: 'critical',
      repo_intel: true,
      skills: [],
    };
    const a = makeBatch({ ranAt: new Date('2026-01-01T00:00:00.000Z') });
    const b = makeBatch({ ranAt: new Date('2026-01-02T00:00:00.000Z') });
    const comparison = buildComparison(a, cfg, b, null);
    expect(comparison.old_config).toEqual(cfg);
    expect(comparison.new_config).toBeNull();
  });

  it('every produced comparison parses as EvalRunComparison, over BOTH a comparable and an incomparable pair', () => {
    // Comparable branch — all fields present, delta all numeric.
    const comparableA = makeBatch({ ranAt: new Date('2026-01-01T00:00:00.000Z'), metricsVersion: 2 });
    const comparableB = makeBatch({ ranAt: new Date('2026-01-02T00:00:00.000Z'), metricsVersion: 2 });
    const comparableResult = buildComparison(comparableA, null, comparableB, null);
    expect(() => EvalRunComparison.parse(comparableResult)).not.toThrow();

    // Incomparable branch — the ONLY one that emits incomparable_reason and
    // null metric deltas; with the IncomparableReason enum in place, this
    // parse also proves the emitted code is a member of that union.
    const incomparableA = makeBatch({ ranAt: new Date('2026-01-01T00:00:00.000Z'), metricsVersion: 1 });
    const incomparableB = makeBatch({ ranAt: new Date('2026-01-02T00:00:00.000Z'), metricsVersion: 2 });
    const incomparableResult = buildComparison(incomparableA, null, incomparableB, null);
    expect(() => EvalRunComparison.parse(incomparableResult)).not.toThrow();
    expect(incomparableResult.incomparable_reason).not.toBeNull();
  });
});

it('every buildDashboard output parses as EvalDashboard once owner_kind/owner_id are filled in (sanity check on the whole suite)', () => {
  const dashboard = buildDashboard([makeBatch()], 1);
  expect(() => EvalDashboard.parse({ ...dashboard, owner_kind: 'agent', owner_id: 'agent1' })).not.toThrow();
});
