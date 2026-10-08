import type { Finding } from '@devdigest/shared';
import { rangesIntersect } from '../grounding.js';

/**
 * scoreEvalCase — the pure eval scorer (spec 0019).
 *
 * Computes recall, precision and citation accuracy for one eval case given the
 * case's expectation(s), the grounded findings a replayed review produced, and
 * the grounding gate's kept/dropped counts. Pure: no LLM, no DB, no filesystem —
 * every input arrives as a plain argument (AC-9, AC-10). Never call this with
 * raw model output; `findings` must already be `ReviewOutcome.review.findings`
 * (grounded), per AC-46.
 *
 * `precision` (the top-level field) is always finding-denominated — correct
 * findings over produced findings — and that is intentional: it is the
 * per-case diagnostic persisted on the `eval_runs` row and read by the UI,
 * and it stays that way even though the BATCH rollup pools a different pair
 * (`mustNotFlagAvoided`/`mustNotFlagTotal`) for its own `precision` metric.
 * Never "fix" this by making the two consistent — see `ScoreEvalCaseResult`.
 */

/** One target a produced finding is checked against — file + inclusive line range. */
export interface EvalExpectation {
  file: string;
  startLine: number;
  endLine: number;
}

export interface ScoreEvalCaseInput {
  /** The case's expectation kind — governs how `pass` is computed (AC-15, AC-16). */
  expectationKind: 'must_find' | 'must_not_flag';
  /** The case's expectation(s) to match findings against. */
  expectations: EvalExpectation[];
  /** The grounded findings produced by replaying the case (never raw output). */
  findings: Finding[];
  /** `GroundingResult.kept.length` for this case's run. */
  kept: number;
  /** `GroundingResult.dropped.length` for this case's run. */
  dropped: number;
}

export interface ScoreEvalCaseResult {
  recall: number;
  precision: number;
  citationAccuracy: number;
  pass: boolean;
  /**
   * Raw counts behind the ratios above, for the batch rollup
   * (`server/src/modules/evals/helpers.ts`'s `rollupBatch`) to combine across
   * cases instead of trusting any ratio this function already computed.
   * `recall` and `precision` are POOLED (summed numerators, summed
   * denominators, divided once); `citationAccuracy` is AVERAGED (one vote
   * per case) — see that file's doc comments for why each metric gets a
   * different combination rule.
   *
   * `recallMatched / recallTotal` mirrors `recall` exactly, and is safe to
   * pool: the denominator (`must_find` expectation count) comes from the
   * database case rows, never from the model.
   *
   * `precisionCorrect / precisionTotal` mirrors the per-case `precision`
   * above — the finding-denominated diagnostic kept on the `eval_runs` row —
   * and must stay finding-denominated there; it is NOT what the batch pools.
   * `mustNotFlagAvoided / mustNotFlagTotal` is the pair the batch pools for
   * `precision` instead: `must_not_flag` expectations this case avoided over
   * total `must_not_flag` expectations, both counts from the case rows. Doing
   * this closes the gap pooling `precisionCorrect`/`precisionTotal` would
   * reopen — that denominator is `findings.length`, a count the model
   * controls, so a `must_not_flag` case emitting many off-target findings
   * would buy itself a weight approaching 1 regardless of every `must_find`
   * case's score (security finding, server/INSIGHTS.md 2026-10-07). With this
   * pair instead, both `recall`'s and `precision`'s batch denominators come
   * from the database, and no model output can move a batch metric's
   * weighting.
   *
   * `citationKept / (citationKept + citationDropped)` is `citationAccuracy`.
   * Its denominator (grounding decisions) is inherently model-derived (what
   * share of PRODUCED findings cited a real diff line) and nothing caps it,
   * so the batch rollup AVERAGES this pair instead of pooling it — pooling
   * would make a case's batch weight proportional to how many findings it
   * happened to emit, the same reward-for-noise `mustNotFlagAvoided` exists
   * to keep out of `precision` (security finding, server/INSIGHTS.md
   * 2026-10-07).
   */
  recallMatched: number;
  recallTotal: number;
  precisionCorrect: number;
  precisionTotal: number;
  /** `must_not_flag` expectations this case avoided (matched by no produced
   *  finding). Always `0` for a `must_find` case. */
  mustNotFlagAvoided: number;
  /** Total `must_not_flag` expectations for this case. Always `0` for a
   *  `must_find` case — that case contributes nothing to batch `precision`,
   *  exactly as a `must_not_flag` case contributes nothing to `recall`. */
  mustNotFlagTotal: number;
  citationKept: number;
  citationDropped: number;
}

/** A produced finding "matches" an expectation: same file, intersecting inclusive ranges (AC-11). */
function findingMatches(finding: Finding, expectation: EvalExpectation): boolean {
  return (
    finding.file === expectation.file &&
    rangesIntersect(finding.start_line, finding.end_line, expectation.startLine, expectation.endLine)
  );
}

export function scoreEvalCase(input: ScoreEvalCaseInput): ScoreEvalCaseResult {
  const { expectationKind, expectations, findings, kept, dropped } = input;

  const mustFindExpectations = expectationKind === 'must_find' ? expectations : [];

  // AC-12 — recall over must_find expectations only; zero denominator → 1 (AC-17).
  const matchedMustFind = mustFindExpectations.filter((e) => findings.some((f) => findingMatches(f, e)));
  const recall = mustFindExpectations.length === 0 ? 1 : matchedMustFind.length / mustFindExpectations.length;

  // AC-13 — precision over produced findings; zero denominator → 1 (AC-17).
  //
  // What makes a finding CORRECT depends on the expectation kind, and the two
  // are opposites. For `must_find`, a finding matching an expectation is the
  // hit. For `must_not_flag`, a finding matching the expectation is precisely
  // the false positive the case was created to catch — counting it as correct
  // would score a case 100% precise for doing the one thing it must not do,
  // and `rollupBatch` would average those 1.0s into the batch tile. A sweep of
  // uniformly-failing dismissed-derived cases would then read as perfect
  // precision, which inverts the signal the whole feature exists to produce.
  const correctFindings =
    expectationKind === 'must_find'
      ? findings.filter((f) => expectations.some((e) => findingMatches(f, e)))
      : findings.filter((f) => !expectations.some((e) => findingMatches(f, e)));
  const precision = findings.length === 0 ? 1 : correctFindings.length / findings.length;

  // must_not_flag expectations this case avoided — the batch's pooled
  // precision numerator/denominator (see ScoreEvalCaseResult's doc comment).
  // Expectation-denominated, never finding-denominated, so it mirrors
  // `recall`'s shape: a `must_find` case contributes nothing here, exactly as
  // a `must_not_flag` case contributes nothing to recall's counts above.
  const mustNotFlagExpectations = expectationKind === 'must_not_flag' ? expectations : [];
  const avoidedMustNotFlag = mustNotFlagExpectations.filter((e) => !findings.some((f) => findingMatches(f, e)));

  // AC-14 — citation accuracy from the grounding gate; zero denominator → 1 (AC-17).
  const citationAccuracy = kept + dropped === 0 ? 1 : kept / (kept + dropped);

  // AC-15 / AC-16 — pass is computed directly, not derived from recall/precision,
  // so it stays correct even when the zero-denominator rule makes a ratio vacuous.
  const pass =
    expectationKind === 'must_find'
      ? expectations.every((e) => findings.some((f) => findingMatches(f, e)))
      : !findings.some((f) => expectations.some((e) => findingMatches(f, e)));

  return {
    recall,
    precision,
    citationAccuracy,
    pass,
    recallMatched: matchedMustFind.length,
    recallTotal: mustFindExpectations.length,
    precisionCorrect: correctFindings.length,
    precisionTotal: findings.length,
    mustNotFlagAvoided: avoidedMustNotFlag.length,
    mustNotFlagTotal: mustNotFlagExpectations.length,
    citationKept: kept,
    citationDropped: dropped,
  };
}
