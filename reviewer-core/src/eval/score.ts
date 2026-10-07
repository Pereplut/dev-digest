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

  // AC-14 — citation accuracy from the grounding gate; zero denominator → 1 (AC-17).
  const citationAccuracy = kept + dropped === 0 ? 1 : kept / (kept + dropped);

  // AC-15 / AC-16 — pass is computed directly, not derived from recall/precision,
  // so it stays correct even when the zero-denominator rule makes a ratio vacuous.
  const pass =
    expectationKind === 'must_find'
      ? expectations.every((e) => findings.some((f) => findingMatches(f, e)))
      : !findings.some((f) => expectations.some((e) => findingMatches(f, e)));

  return { recall, precision, citationAccuracy, pass };
}
