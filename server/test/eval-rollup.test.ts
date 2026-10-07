import { describe, it, expect } from 'vitest';
import { rollupBatch, type EvalCaseResult } from '../src/modules/evals/helpers.js';

/**
 * AC-18, AC-19, AC-20, AC-65 — the spec's exact table (specs/0019-evals.md:489):
 * three cases (scored, scored, failed-with-null-metrics) → means over the two
 * scored, cases_total 3, cost_usd the exact decimal sum with no float
 * accumulator, duration_ms from the two plain timestamps. Then the null path:
 * one null cost makes the batch's cost_usd null, not a partial sum, while the
 * three metric means are unchanged.
 */
describe('rollupBatch', () => {
  const scoredA: EvalCaseResult = {
    pass: true,
    recall: 1,
    precision: 0.5,
    citationAccuracy: 1,
    costUsd: 0.000001,
  };
  const scoredB: EvalCaseResult = {
    pass: false,
    recall: 0,
    precision: 1,
    citationAccuracy: 0.75,
    costUsd: 0.000002,
  };
  const failedWithNullMetrics: EvalCaseResult = {
    pass: false,
    recall: null,
    precision: null,
    citationAccuracy: null,
    costUsd: null,
  };

  it('means run over cases with non-null metrics only; cases_total counts every queued case', () => {
    const rollup = rollupBatch([scoredA, scoredB, failedWithNullMetrics], 1_000, 1_500);
    expect(rollup.casesTotal).toBe(3);
    expect(rollup.casesPassed).toBe(1);
    expect(rollup.recall).toBeCloseTo(0.5, 10); // mean(1, 0)
    expect(rollup.precision).toBeCloseTo(0.75, 10); // mean(0.5, 1)
    expect(rollup.citationAccuracy).toBeCloseTo(0.875, 10); // mean(1, 0.75)
    expect(rollup.durationMs).toBe(500);
  });

  it('cost_usd is the exact decimal sum of non-null costs — no float accumulator', () => {
    // 0.000001 + 0.000002 as a binary-float += can drift off the exact value;
    // the scaled-integer sum must not.
    const rollup = rollupBatch([scoredA, scoredB], 0, 0);
    expect(rollup.costUsd).toBe(0.000003);
  });

  it('AC-65: one null cost makes the batch cost_usd null, never a partial sum', () => {
    const withOneNullCost: EvalCaseResult = { ...scoredB, costUsd: null };
    const rollup = rollupBatch([scoredA, withOneNullCost], 0, 100);
    expect(rollup.costUsd).toBeNull();
    // the metric means are unaffected by the null cost
    expect(rollup.recall).toBeCloseTo(0.5, 10);
    expect(rollup.precision).toBeCloseTo(0.75, 10);
    expect(rollup.citationAccuracy).toBeCloseTo(0.875, 10);
  });

  it('all-null-metric cases yield null means, zero passed, and zero cost (0 is a cost, not an absence)', () => {
    const rollup = rollupBatch([failedWithNullMetrics, failedWithNullMetrics], 0, 10);
    expect(rollup.recall).toBeNull();
    expect(rollup.precision).toBeNull();
    expect(rollup.citationAccuracy).toBeNull();
    expect(rollup.casesPassed).toBe(0);
    // null is propagated since both costs here are null, not a zero sum
    expect(rollup.costUsd).toBeNull();
  });

  it('a case whose model call never ran still has a real (zero) cost, which the sum treats as a number', () => {
    const zeroCost: EvalCaseResult = { ...failedWithNullMetrics, costUsd: 0 };
    const rollup = rollupBatch([zeroCost, scoredA], 0, 0);
    expect(rollup.costUsd).toBe(0.000001);
  });

  it('zero cases: totals are zero, means are null, duration still reflects the clock', () => {
    const rollup = rollupBatch([], 10, 20);
    expect(rollup).toEqual({
      casesTotal: 0,
      casesPassed: 0,
      recall: null,
      precision: null,
      citationAccuracy: null,
      durationMs: 10,
      costUsd: null,
    });
  });
});
