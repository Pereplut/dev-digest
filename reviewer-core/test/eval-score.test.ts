import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Finding } from '@devdigest/shared';
import { scoreEvalCase, rangesIntersect, type EvalExpectation } from '../src/index.js';

/**
 * Pure-scorer tests for spec 0019 (AC-9 through AC-17), plus the AC-10 static
 * import assertion and the AC-11 range-intersection table.
 */

function finding(overrides: Partial<Finding> & Pick<Finding, 'file' | 'start_line' | 'end_line'>): Finding {
  return {
    id: overrides.id ?? 'f1',
    severity: 'WARNING',
    category: 'bug',
    title: 'finding',
    rationale: 'because',
    confidence: 0.9,
    ...overrides,
  };
}

function expectation(file: string, startLine: number, endLine: number): EvalExpectation {
  return { file, startLine, endLine };
}

describe('rangesIntersect (AC-11)', () => {
  it('matches an overlapping range on the same file', () => {
    expect(rangesIntersect(10, 20, 15, 25)).toBe(true);
  });

  it('does not match an adjacent-but-disjoint range', () => {
    expect(rangesIntersect(10, 20, 21, 30)).toBe(false);
  });

  it('normalises a reversed start/end pair', () => {
    expect(rangesIntersect(20, 10, 15, 25)).toBe(true);
  });

  it('returns without iterating for a model-controlled end_line of 2_000_000_000', () => {
    const start = Date.now();
    expect(rangesIntersect(1, 2_000_000_000, 5, 5)).toBe(true);
    expect(Date.now() - start).toBeLessThan(50);
  });
});

describe('scoreEvalCase — matching (AC-11, via file identity)', () => {
  it('does not match the same range on a different file', () => {
    const result = scoreEvalCase({
      expectationKind: 'must_find',
      expectations: [expectation('a.ts', 10, 20)],
      findings: [finding({ file: 'b.ts', start_line: 10, end_line: 20 })],
      kept: 1,
      dropped: 0,
    });
    expect(result.recall).toBe(0);
    expect(result.pass).toBe(false);
    expect(result.recallMatched).toBe(0);
    expect(result.recallTotal).toBe(1);
  });
});

describe('scoreEvalCase — recall / precision (AC-12, AC-13)', () => {
  it('recall is matched / total must_find expectations', () => {
    const result = scoreEvalCase({
      expectationKind: 'must_find',
      expectations: [expectation('a.ts', 1, 5), expectation('b.ts', 1, 5)],
      findings: [finding({ file: 'a.ts', start_line: 2, end_line: 2 })],
      kept: 1,
      dropped: 0,
    });
    expect(result.recall).toBe(0.5);
    expect(result.recallMatched).toBe(1);
    expect(result.recallTotal).toBe(2);
    // a must_find case contributes nothing to the batch's precision pool.
    expect(result.mustNotFlagAvoided).toBe(0);
    expect(result.mustNotFlagTotal).toBe(0);
  });

  it('precision is matching / total produced findings', () => {
    const result = scoreEvalCase({
      expectationKind: 'must_find',
      expectations: [expectation('a.ts', 1, 5)],
      findings: [
        finding({ id: 'f1', file: 'a.ts', start_line: 2, end_line: 2 }),
        finding({ id: 'f2', file: 'b.ts', start_line: 2, end_line: 2 }),
        finding({ id: 'f3', file: 'c.ts', start_line: 2, end_line: 2 }),
      ],
      kept: 3,
      dropped: 0,
    });
    expect(result.precision).toBeCloseTo(0.333, 3);
    expect(result.precisionCorrect).toBe(1);
    expect(result.precisionTotal).toBe(3);
  });

  it('scores 1 on both when everything matches', () => {
    const result = scoreEvalCase({
      expectationKind: 'must_find',
      expectations: [expectation('a.ts', 1, 5)],
      findings: [finding({ file: 'a.ts', start_line: 2, end_line: 2 })],
      kept: 1,
      dropped: 0,
    });
    expect(result.recall).toBe(1);
    expect(result.precision).toBe(1);
    expect(result.recallMatched).toBe(1);
    expect(result.recallTotal).toBe(1);
    expect(result.precisionCorrect).toBe(1);
    expect(result.precisionTotal).toBe(1);
  });

  // The kind inversion (AC-13). Without these two, a `must_not_flag` case that
  // flags exactly the forbidden range scored `precision 1`, and `rollupBatch`
  // averaged those into the batch tile — so a sweep of uniformly-FAILING
  // dismissed-derived cases displayed 100% precision, inverting the signal the
  // whole feature exists to produce. Both directions are pinned, because a fix
  // that simply negated the test would pass the first of these and fail this.
  it('precision is 0 when a must_not_flag case flags exactly the forbidden range', () => {
    const result = scoreEvalCase({
      expectationKind: 'must_not_flag',
      expectations: [expectation('a.ts', 1, 5)],
      findings: [finding({ file: 'a.ts', start_line: 2, end_line: 2 })],
      kept: 1,
      dropped: 0,
    });
    expect(result.precision).toBe(0);
    expect(result.pass).toBe(false);
    expect(result.precisionCorrect).toBe(0);
    expect(result.precisionTotal).toBe(1);
    // the one expectation was hit, not avoided — the batch's precision pool
    // (expectation-denominated) must count it as 0 of 1.
    expect(result.mustNotFlagAvoided).toBe(0);
    expect(result.mustNotFlagTotal).toBe(1);
  });

  it('precision is 1 when a must_not_flag case reports only findings elsewhere', () => {
    const result = scoreEvalCase({
      expectationKind: 'must_not_flag',
      expectations: [expectation('a.ts', 1, 5)],
      findings: [finding({ file: 'b.ts', start_line: 2, end_line: 2 })],
      kept: 1,
      dropped: 0,
    });
    expect(result.precision).toBe(1);
    expect(result.pass).toBe(true);
    expect(result.precisionCorrect).toBe(1);
    expect(result.precisionTotal).toBe(1);
    // the one expectation was avoided — 1 of 1 for the batch's precision pool.
    expect(result.mustNotFlagAvoided).toBe(1);
    expect(result.mustNotFlagTotal).toBe(1);
  });

  // The security fix (server/INSIGHTS.md 2026-10-07, `security#1`): a
  // `must_not_flag` case's contribution to the batch's precision pool is
  // counted in EXPECTATIONS, not in produced findings — so flooding the
  // case with off-target noise cannot move it. One finding elsewhere, or a
  // thousand, the one forbidden-range expectation is avoided either way.
  it('mustNotFlagAvoided/mustNotFlagTotal are unaffected by how many off-target findings a case produces', () => {
    const quiet = scoreEvalCase({
      expectationKind: 'must_not_flag',
      expectations: [expectation('a.ts', 1, 5)],
      findings: [finding({ id: 'f1', file: 'b.ts', start_line: 2, end_line: 2 })],
      kept: 1,
      dropped: 0,
    });
    const flooded = scoreEvalCase({
      expectationKind: 'must_not_flag',
      expectations: [expectation('a.ts', 1, 5)],
      findings: Array.from({ length: 1_000 }, (_, i) =>
        finding({ id: `f${i}`, file: 'b.ts', start_line: 2, end_line: 2 }),
      ),
      kept: 1_000,
      dropped: 0,
    });
    expect(quiet.mustNotFlagAvoided).toBe(1);
    expect(quiet.mustNotFlagTotal).toBe(1);
    expect(flooded.mustNotFlagAvoided).toBe(1);
    expect(flooded.mustNotFlagTotal).toBe(1);
    // `precisionCorrect`/`precisionTotal` — the per-case diagnostic — DOES
    // move with the flood; only the batch-pooled pair is immune to it.
    expect(flooded.precisionTotal).toBe(1_000);
  });

  // The kind inversion, at the count level: a `must_not_flag` case whose
  // findings are ALL on the forbidden range reports 0 correct of N produced —
  // not N correct of N, which is what a kind-blind predicate would count.
  it('counts 0 correct of N produced when every finding hits the forbidden range (must_not_flag)', () => {
    const result = scoreEvalCase({
      expectationKind: 'must_not_flag',
      expectations: [expectation('a.ts', 1, 5)],
      findings: [
        finding({ id: 'f1', file: 'a.ts', start_line: 2, end_line: 2 }),
        finding({ id: 'f2', file: 'a.ts', start_line: 3, end_line: 3 }),
        finding({ id: 'f3', file: 'a.ts', start_line: 4, end_line: 4 }),
      ],
      kept: 3,
      dropped: 0,
    });
    expect(result.precisionCorrect).toBe(0);
    expect(result.precisionTotal).toBe(3);
    expect(result.precision).toBe(0);
    // recall is vacuous for a must_not_flag case — zero must_find expectations.
    expect(result.recallMatched).toBe(0);
    expect(result.recallTotal).toBe(0);
    // the one expectation was hit, so 0 of 1 for the batch's precision pool —
    // independent of there being 3 produced findings, all on the forbidden range.
    expect(result.mustNotFlagAvoided).toBe(0);
    expect(result.mustNotFlagTotal).toBe(1);
  });
});

describe('scoreEvalCase — citation accuracy (AC-14)', () => {
  it('is kept / (kept + dropped)', () => {
    const result = scoreEvalCase({
      expectationKind: 'must_find',
      expectations: [expectation('a.ts', 1, 5)],
      findings: [finding({ file: 'a.ts', start_line: 2, end_line: 2 })],
      kept: 3,
      dropped: 1,
    });
    expect(result.citationAccuracy).toBe(0.75);
    expect(result.citationKept).toBe(3);
    expect(result.citationDropped).toBe(1);
  });

  it('is 1 with zero dropped', () => {
    const result = scoreEvalCase({
      expectationKind: 'must_find',
      expectations: [expectation('a.ts', 1, 5)],
      findings: [finding({ file: 'a.ts', start_line: 2, end_line: 2 })],
      kept: 4,
      dropped: 0,
    });
    expect(result.citationAccuracy).toBe(1);
    expect(result.citationKept).toBe(4);
    expect(result.citationDropped).toBe(0);
  });
});

describe('scoreEvalCase — pass (AC-15, AC-16)', () => {
  it('must_find passes iff every expectation is matched', () => {
    const twoOfTwo = scoreEvalCase({
      expectationKind: 'must_find',
      expectations: [expectation('a.ts', 1, 5), expectation('b.ts', 1, 5)],
      findings: [
        finding({ id: 'f1', file: 'a.ts', start_line: 2, end_line: 2 }),
        finding({ id: 'f2', file: 'b.ts', start_line: 2, end_line: 2 }),
      ],
      kept: 2,
      dropped: 0,
    });
    expect(twoOfTwo.pass).toBe(true);

    const oneOfTwo = scoreEvalCase({
      expectationKind: 'must_find',
      expectations: [expectation('a.ts', 1, 5), expectation('b.ts', 1, 5)],
      findings: [finding({ id: 'f1', file: 'a.ts', start_line: 2, end_line: 2 })],
      kept: 1,
      dropped: 0,
    });
    expect(oneOfTwo.pass).toBe(false);
  });

  it('must_not_flag passes iff no finding matches the expected file+range', () => {
    const noMatch = scoreEvalCase({
      expectationKind: 'must_not_flag',
      expectations: [expectation('a.ts', 1, 5)],
      findings: [finding({ file: 'b.ts', start_line: 2, end_line: 2 })],
      kept: 1,
      dropped: 0,
    });
    expect(noMatch.pass).toBe(true);

    const matched = scoreEvalCase({
      expectationKind: 'must_not_flag',
      expectations: [expectation('a.ts', 1, 5)],
      findings: [finding({ file: 'a.ts', start_line: 2, end_line: 2 })],
      kept: 1,
      dropped: 0,
    });
    expect(matched.pass).toBe(false);

    const noFindings = scoreEvalCase({
      expectationKind: 'must_not_flag',
      expectations: [expectation('a.ts', 1, 5)],
      findings: [],
      kept: 0,
      dropped: 0,
    });
    expect(noFindings.pass).toBe(true);
  });
});

describe('scoreEvalCase — zero denominators (AC-17)', () => {
  it('never returns NaN, null or undefined for any ratio', () => {
    // must_not_flag: no must_find expectations → recall denominator is 0.
    // No findings produced → precision denominator is 0.
    // No grounding decisions → citation_accuracy denominator is 0.
    const result = scoreEvalCase({
      expectationKind: 'must_not_flag',
      expectations: [expectation('a.ts', 1, 5)],
      findings: [],
      kept: 0,
      dropped: 0,
    });
    expect(result.recall).toBe(1);
    expect(result.precision).toBe(1);
    expect(result.citationAccuracy).toBe(1);
    expect(Number.isFinite(result.recall)).toBe(true);
    expect(Number.isFinite(result.precision)).toBe(true);
    expect(Number.isFinite(result.citationAccuracy)).toBe(true);
    // the zero-denominator convention shows up as 0/0 in the counts too.
    expect(result.recallMatched).toBe(0);
    expect(result.recallTotal).toBe(0);
    expect(result.precisionCorrect).toBe(0);
    expect(result.precisionTotal).toBe(0);
    expect(result.citationKept).toBe(0);
    expect(result.citationDropped).toBe(0);
    // this case does have one must_not_flag expectation, and it was avoided
    // (there were no findings at all) — 1 of 1, not a zero denominator here.
    expect(result.mustNotFlagAvoided).toBe(1);
    expect(result.mustNotFlagTotal).toBe(1);
  });

  it('mustNotFlagTotal is zero (and avoided is zero) for a must_find case — it has no must_not_flag expectations', () => {
    const result = scoreEvalCase({
      expectationKind: 'must_find',
      expectations: [expectation('a.ts', 1, 5)],
      findings: [],
      kept: 0,
      dropped: 0,
    });
    expect(result.mustNotFlagAvoided).toBe(0);
    expect(result.mustNotFlagTotal).toBe(0);
  });
});

describe('score.ts static import assertion (AC-10)', () => {
  /** Specifiers a pure scorer must never import — I/O of any kind. */
  const FORBIDDEN = [/^node:/, /^openai$/, /^@anthropic-ai\//, /^pg$/, /^postgres$/, /^drizzle-orm/];

  function importSpecifiers(source: string): string[] {
    const specifiers: string[] = [];
    const importRe = /import\s+(?:[^'"]+?from\s+)?['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = importRe.exec(source))) specifiers.push(match[1] ?? '');
    return specifiers;
  }

  function hasForbiddenImport(source: string): boolean {
    return importSpecifiers(source).some((spec) => FORBIDDEN.some((re) => re.test(spec)));
  }

  it('score.ts imports no LLM provider, no DB client and no node: builtin', () => {
    const scorePath = fileURLToPath(new URL('../src/eval/score.ts', import.meta.url));
    const source = readFileSync(scorePath, 'utf8');
    expect(hasForbiddenImport(source)).toBe(false);
  });

  it('negative control: the same assertion fails on a file that does import node:fs', () => {
    const tainted = `import { readFileSync } from 'node:fs';\nexport const x = 1;\n`;
    expect(hasForbiddenImport(tainted)).toBe(true);
  });
});
