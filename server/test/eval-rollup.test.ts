import { describe, it, expect } from 'vitest';
import { rollupBatch, type EvalCaseResult } from '../src/modules/evals/helpers.js';

/**
 * AC-18, AC-19, AC-20, AC-65 — the spec's exact table (specs/0019-evals.md:489):
 * three cases (scored, scored, failed-with-null-metrics) → cases_total 3,
 * cost_usd the exact decimal sum with no float accumulator, duration_ms from
 * the two plain timestamps. Then the null path: one null cost makes the
 * batch's cost_usd null, not a partial sum, while the other three metrics
 * are unchanged.
 *
 * `rollupBatch` combines per-case counts two different ways, by metric:
 * `recall` and `precision` are POOLED (sum numerators, sum denominators,
 * divide once); `citationAccuracy` is AVERAGED (one vote per case, no
 * pooling). An unweighted mean over ALL three metrics measurably cancelled a
 * real regression (server/INSIGHTS.md 2026-10-07) — that is why `recall`/
 * `precision` are pooled. Pooling `citationAccuracy` traded that bug for
 * another: its denominator is a produced-finding count the model controls
 * and does not cap, so pooling let one case's finding count outweigh
 * another's grounding score (security finding, server/INSIGHTS.md
 * 2026-10-07) — that is why it is averaged instead. See the three
 * "pooled/averaged vs the other combination" describe blocks below.
 * `precisionAvoided`/`precisionAvoidedTotal` on `EvalCaseResult` hold
 * `must_not_flag` expectation counts (spec 0019's AC-13 amendment), not
 * finding counts — see `helpers.ts`'s doc comments for why that matters.
 */
describe('rollupBatch', () => {
  const scoredA: EvalCaseResult = {
    pass: true,
    recallMatched: 1,
    recallTotal: 1,
    precisionAvoided: 1,
    precisionAvoidedTotal: 2,
    citationKept: 4,
    citationDropped: 0,
    costUsd: 0.000001,
  };
  const scoredB: EvalCaseResult = {
    pass: false,
    recallMatched: 0,
    recallTotal: 1,
    precisionAvoided: 2,
    precisionAvoidedTotal: 2,
    citationKept: 3,
    citationDropped: 1,
    costUsd: 0.000002,
  };
  const failedWithNullMetrics: EvalCaseResult = {
    pass: false,
    recallMatched: null,
    recallTotal: null,
    precisionAvoided: null,
    precisionAvoidedTotal: null,
    citationKept: null,
    citationDropped: null,
    costUsd: null,
  };

  it('pools over cases with non-null counts only; cases_total counts every queued case', () => {
    const rollup = rollupBatch([scoredA, scoredB, failedWithNullMetrics], 1_000, 1_500);
    expect(rollup.casesTotal).toBe(3);
    expect(rollup.casesPassed).toBe(1);
    expect(rollup.recall).toBeCloseTo(0.5, 10); // pooled (1+0)/(1+1)
    expect(rollup.precision).toBeCloseTo(0.75, 10); // pooled (1+2)/(2+2)
    // averaged, not pooled: (4/4 + 3/4) / 2 = (1 + 0.75) / 2 = 0.875 — the two
    // cases happen to have the same denominator (4), so this fixture alone
    // cannot distinguish averaging from pooling; the dedicated describe
    // block below uses unequal denominators to do that.
    expect(rollup.citationAccuracy).toBeCloseTo(0.875, 10);
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
    // the other metrics are unaffected by the null cost
    expect(rollup.recall).toBeCloseTo(0.5, 10);
    expect(rollup.precision).toBeCloseTo(0.75, 10);
    expect(rollup.citationAccuracy).toBeCloseTo(0.875, 10);
  });

  it('all-null-count cases yield null pooled metrics, zero passed, and zero cost (0 is a cost, not an absence)', () => {
    const rollup = rollupBatch([failedWithNullMetrics, failedWithNullMetrics], 0, 10);
    expect(rollup.recall).toBeNull();
    expect(rollup.precision).toBeNull();
    expect(rollup.citationAccuracy).toBeNull();
    expect(rollup.casesPassed).toBe(0);
    // null is propagated since both costs here are null, not a zero sum
    expect(rollup.costUsd).toBeNull();
  });

  // W2's regression test: the zero-denominator convention is a PER-CASE rule
  // (AC-17 — one case with nothing to judge reads as perfect). At batch
  // scope it must not apply: every `must_find` case contributes `0/0` to
  // `precision`'s pool, so an all-`must_find` batch — the default shape,
  // since nothing requires a dismissed case — has a pooled denominator of 0
  // and must read as "nothing measured" (`null`, rendered as the UI's
  // placeholder), never as "perfect" (`1`). Before this fix, this batch
  // reported `precision: 1` however many false positives the model emitted.
  it('an all-must_find batch (pooled precision denominator 0) pins precision to null, not 1', () => {
    const mustFind1: EvalCaseResult = {
      pass: true,
      recallMatched: 1,
      recallTotal: 1,
      precisionAvoided: 0,
      precisionAvoidedTotal: 0,
      citationKept: 1,
      citationDropped: 0,
      costUsd: 0.00001,
    };
    const mustFind2: EvalCaseResult = {
      pass: false,
      recallMatched: 0,
      recallTotal: 1,
      precisionAvoided: 0,
      precisionAvoidedTotal: 0,
      citationKept: 5,
      citationDropped: 1,
      costUsd: 0.00001,
    };

    const rollup = rollupBatch([mustFind1, mustFind2], 0, 0);

    expect(rollup.precision).toBeNull();
    // recall is still a real measurement here (both cases are must_find).
    expect(rollup.recall).toBeCloseTo(0.5, 10);
  });

  it('a case whose model call never ran still has a real (zero) cost, which the sum treats as a number', () => {
    const zeroCost: EvalCaseResult = { ...failedWithNullMetrics, costUsd: 0 };
    const rollup = rollupBatch([zeroCost, scoredA], 0, 0);
    expect(rollup.costUsd).toBe(0.000001);
  });

  it('zero cases: totals are zero, pooled metrics are null, duration still reflects the clock', () => {
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

/**
 * Each case kind drives exactly one metric, and no batch denominator is
 * model-controlled (spec 0019 AC-13/AC-18 amendment, `/pr-self-review`
 * `security#1` and `typescript-expert#1`). A `must_find` case contributes
 * `0/0` to `precision`'s pool; a `must_not_flag` case contributes `0/0` to
 * `recall`'s pool. Both pools are counts of database case rows —
 * `must_find`/`must_not_flag` EXPECTATIONS — never counts of produced
 * findings. `citationAccuracy` is different: its pair IS a produced-finding
 * count, and its own describe block below AVERAGES it instead, for exactly
 * that reason.
 *
 * Every assertion below reads `rollup.<metric>`, the real `rollupBatch`
 * output — never a bare arithmetic identity on a test-local constant, which
 * cannot fail and proves nothing about the code under test.
 *
 * What the `recall`/`precision` blocks below actually pin: in production
 * every eval case row carries exactly one expectation
 * (`server/src/modules/evals/run-executor.ts` builds a single-element
 * `expectations` array from the case row's scalar fields), so
 * `recallTotal`/`precisionAvoidedTotal` are always 0 or 1 — pooling two
 * SAME-kind cases together never weights one over the other, because their
 * denominators are always equal. What pooling buys here is excluding the
 * OPPOSITE kind's vacuous `0/0` contribution instead of averaging in its
 * per-case `1` (AC-17's zero-denominator convention). The tests below use a
 * synthetic denominator above 1 on one case purely to exercise `poolRatio`'s
 * summing arithmetic; they do not exercise cross-case weighting, because
 * that is unreachable with this harness's one-expectation-per-case shape.
 * `citationAccuracy`'s denominator (produced findings) has no such ceiling,
 * which is exactly why it is averaged, not pooled (see that describe block).
 */
describe('rollupBatch — recall pools must_find expectation counts', () => {
  it('a must_find case at 1/2 beside a must_not_flag case that contributes nothing pools to 0.5, not the old mean of 0.75', () => {
    const mustFind: EvalCaseResult = {
      pass: false,
      recallMatched: 1,
      recallTotal: 2,
      precisionAvoided: 0,
      precisionAvoidedTotal: 0,
      citationKept: 2,
      citationDropped: 0,
      costUsd: 0.00001,
    };
    // A must_not_flag case contributes 0/0 to recall (AC-17's zero-denominator
    // convention gives it a per-case recall of 1, the value the OLD mean
    // would have averaged in).
    const mustNotFlag: EvalCaseResult = {
      pass: true,
      recallMatched: 0,
      recallTotal: 0,
      precisionAvoided: 1,
      precisionAvoidedTotal: 1,
      citationKept: 1,
      citationDropped: 0,
      costUsd: 0.00001,
    };

    const rollup = rollupBatch([mustFind, mustNotFlag], 0, 0);

    // Pooled: 1 matched of 2 must_find expectations, the must_not_flag case
    // contributing 0/0 — (1+0)/(2+0) = 0.5.
    expect(rollup.recall).toBeCloseTo(0.5, 10);
    // The old unweighted mean would have averaged in the must_not_flag case's
    // vacuous per-case recall of 1: (0.5 + 1) / 2 = 0.75 — a different value,
    // asserted against the SAME rollup output, not a bare local constant.
    expect(rollup.recall).not.toBeCloseTo(0.75, 2);
  });
});

// Same caveat as the recall block above: every fixture here gives each
// contributing must_not_flag case a denominator of 1 (real case rows never
// carry more than one expectation), so this pins the EXCLUSION of the
// must_find case's vacuous 0/0 contribution, not cross-case weighting
// (`typescript-expert#1`) — weighting among same-kind cases is unreachable
// with this harness's shape, same as for recall.
describe('rollupBatch — precision pools must_not_flag expectation counts, never finding counts', () => {
  it('one must_not_flag expectation hit and two avoided pools to 2/3', () => {
    // Three must_not_flag cases (one expectation each, matching how a real
    // eval case is shaped): two avoided the forbidden range, one was hit.
    const avoided1: EvalCaseResult = {
      pass: true,
      recallMatched: 0,
      recallTotal: 0,
      precisionAvoided: 1,
      precisionAvoidedTotal: 1,
      citationKept: 5,
      citationDropped: 0,
      costUsd: 0.00001,
    };
    const avoided2: EvalCaseResult = { ...avoided1, citationKept: 3 };
    const hit: EvalCaseResult = {
      pass: false,
      recallMatched: 0,
      recallTotal: 0,
      precisionAvoided: 0,
      precisionAvoidedTotal: 1,
      citationKept: 5,
      citationDropped: 0,
      costUsd: 0.00001,
    };
    // A must_find case in the same batch must contribute nothing to precision.
    const mustFind: EvalCaseResult = {
      pass: true,
      recallMatched: 1,
      recallTotal: 1,
      precisionAvoided: 0,
      precisionAvoidedTotal: 0,
      citationKept: 1,
      citationDropped: 0,
      costUsd: 0.00001,
    };

    const rollup = rollupBatch([avoided1, avoided2, hit, mustFind], 0, 0);

    expect(rollup.precision).toBeCloseTo(2 / 3, 10);
  });

  // `/pr-self-review` `typescript-expert#1`: this file used to carry a test
  // named "a case's produced-finding count cannot move batch precision at
  // all", built by varying `citationKept` between two otherwise-identical
  // fixtures. `citationKept` feeds `citationAccuracy` only — both fixtures
  // carried the SAME `precisionAvoided`/`precisionAvoidedTotal`, so
  // `rollup.precision` was 1 in both by construction, and the test would
  // have stayed green even if `run-executor.ts`'s mapping were reverted to
  // the old finding-denominated pair it replaced. Removed as a vacuous
  // duplicate: the real property — a `must_not_flag` case's contribution to
  // the batch is immune to how many findings its model call produced — is
  // genuinely pinned by `reviewer-core/test/eval-score.test.ts`'s
  // "mustNotFlagAvoided/mustNotFlagTotal are unaffected by how many
  // off-target findings a case produces" test, which calls `scoreEvalCase`
  // itself rather than hand-writing the counts it returns.
});

/**
 * `citationAccuracy` is AVERAGED, never pooled — the opposite rule from
 * `recall`/`precision` above, and for a reason specific to this metric: its
 * denominator (`citationKept + citationDropped`) is a count of findings the
 * MODEL produced, and nothing between the model and that counter caps it
 * (`run-executor.ts` sets `kept`/`dropped` straight from
 * `outcome.review.findings.length`/`outcome.dropped.length`). Pooling it —
 * as a `/pr-self-review` security finding caught live — would make a case's
 * batch WEIGHT proportional to how many findings it happened to emit: one
 * case emitting 1000 grounded findings pools to ~1.0 beside a second case at
 * 0 kept of 50, regardless of how badly the second case actually grounded
 * (pooled: 1000/1050 ≈ 0.95; a mean of the two per-case ratios gives 0.50).
 * The mean gives both cases one vote each, independent of either one's
 * finding count.
 */
describe('rollupBatch — citation_accuracy averages per-case ratios, never pools finding counts', () => {
  it('unequal per-case denominators average to 0.7, not the pooled 19/22', () => {
    const smallCase: EvalCaseResult = {
      pass: true,
      recallMatched: 0,
      recallTotal: 0,
      precisionAvoided: 1,
      precisionAvoidedTotal: 1,
      citationKept: 1,
      citationDropped: 1,
      costUsd: 0.00001,
    };
    const bigCase: EvalCaseResult = {
      pass: true,
      recallMatched: 1,
      recallTotal: 1,
      precisionAvoided: 0,
      precisionAvoidedTotal: 0,
      citationKept: 18,
      citationDropped: 2,
      costUsd: 0.00001,
    };

    const rollup = rollupBatch([smallCase, bigCase], 0, 0);

    // Averaged: mean of the two per-case ratios (0.5 and 0.9) is 0.7.
    expect(rollup.citationAccuracy).toBeCloseTo(0.7, 10);
    // Pooling (the old behaviour) would give (1 + 18) kept of (2 + 20)
    // kept+dropped = 19/22 ≈ 0.864 — a different value, asserted against the
    // same rollup output, not a bare local constant.
    expect(rollup.citationAccuracy).not.toBeCloseTo(19 / 22, 2);
  });

  // Mutation check for the fix itself: one case's finding count dwarfing
  // another's must not let it dominate the batch tile. Temporarily pooling
  // this metric (reverting `meanRatio` to `poolRatio` in `rollupBatch`)
  // makes this test FAIL — confirmed live: pooled gives (1000 + 0) /
  // (1000 + 0 + 50) ≈ 0.952, which is NOT close to the 0.5 this test
  // requires.
  it("one case emitting 1000x another's finding count does not move the batch average toward it", () => {
    const quietButPerfect: EvalCaseResult = {
      pass: true,
      recallMatched: 0,
      recallTotal: 0,
      precisionAvoided: 1,
      precisionAvoidedTotal: 1,
      citationKept: 1_000,
      citationDropped: 0, // perfect grounding, but a flood of findings
      costUsd: 0.00001,
    };
    const smallButUngrounded: EvalCaseResult = {
      pass: true,
      recallMatched: 0,
      recallTotal: 0,
      precisionAvoided: 1,
      precisionAvoidedTotal: 1,
      citationKept: 0,
      citationDropped: 50, // every one of its findings was dropped
      costUsd: 0.00001,
    };

    const rollup = rollupBatch([quietButPerfect, smallButUngrounded], 0, 0);

    // One vote each: (1.0 + 0.0) / 2 = 0.5, not dragged toward the
    // high-volume case's 1000/1000 = 1.0.
    expect(rollup.citationAccuracy).toBeCloseTo(0.5, 10);
  });
});
