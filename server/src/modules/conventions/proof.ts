/**
 * Code-side proof for an extracted convention.
 *
 * The model is asked to cite `file:line` plus the snippet it saw. None of that
 * is trusted: this step re-opens the file and checks the claim. A candidate
 * whose evidence cannot be found is REJECTED — that is the requirement, and it
 * is what stops a plausible-sounding but invented rule reaching a skill.
 *
 * A pure function over the file's text, so every branch unit-tests without a
 * clone, a DB or a model.
 */
import type { ConventionRejectReason } from '@devdigest/shared';
import { MIN_INFORMATIVE_CHARS, PROOF_LINE_SLACK } from './constants.js';

export interface EvidenceClaim {
  evidencePath: string;
  evidenceStartLine: number | null;
  evidenceEndLine: number | null;
  evidenceSnippet: string;
}

export type ProofResult =
  | {
      ok: true;
      /** Snippet re-read from the file — never the model's copy. */
      snippet: string;
      startLine: number;
      endLine: number;
    }
  | { ok: false; reason: ConventionRejectReason };

/**
 * @param fileContent the file's text, or `null` when it does not exist.
 */
export function validateEvidence(
  fileContent: string | null,
  claim: EvidenceClaim,
  slack = PROOF_LINE_SLACK,
): ProofResult {
  if (fileContent === null) return { ok: false, reason: 'file_not_found' };

  const lines = fileContent.replace(/\r\n/g, '\n').split('\n');
  const start = claim.evidenceStartLine ?? 1;
  const end = claim.evidenceEndLine ?? start;

  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return { ok: false, reason: 'line_out_of_range' };
  }
  if (start < 1 || end < start || start > lines.length) {
    return { ok: false, reason: 'line_out_of_range' };
  }

  // Clamp the end rather than rejecting: a model that over-runs the file by a
  // line or two still pointed at the right place.
  const clampedEnd = Math.min(end, lines.length);

  // Search a slightly wider window than the cited range, so a small off-by-N in
  // the model's line count still proves out. The FILE and the REGION stay strict.
  const windowStart = Math.max(1, start - slack);
  const windowEnd = Math.min(lines.length, clampedEnd + slack);
  // Blank lines are dropped on both sides so that a difference in blank-line
  // placement cannot break the contiguity check below.
  const windowLines = lines
    .slice(windowStart - 1, windowEnd)
    .map(normalizeLine)
    .filter((l) => l.length > 0);

  const wanted = claim.evidenceSnippet
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(normalizeLine)
    .filter((l) => l.length > 0);

  // An empty snippet proves nothing.
  if (wanted.length === 0) return { ok: false, reason: 'snippet_not_found' };

  /*
   * Two guards, because this is the ONLY code-side control on rule integrity
   * and the model that produced the claim was steered by untrusted repository
   * text (see prompt.ts).
   *
   * 1. The snippet must carry real signal. A per-line `includes` test used to
   *    accept `}` or `const`, which are substrings of some line in nearly every
   *    window — so an invented rule citing a short range proved out, was stored
   *    with evidenceValid, and became eligible for a skill body.
   * 2. The lines must appear CONTIGUOUSLY and IN ORDER, compared whole. Matching
   *    each line independently anywhere in the window proves only that the file
   *    contains those fragments somewhere, not that the cited region is what the
   *    model claimed it was.
   */
  if (!wanted.some(isInformative)) return { ok: false, reason: 'snippet_not_found' };
  if (!containsRun(windowLines, wanted)) return { ok: false, reason: 'snippet_not_found' };

  return {
    ok: true,
    snippet: lines.slice(start - 1, clampedEnd).join('\n'),
    startLine: start,
    endLine: clampedEnd,
  };
}

/**
 * Whitespace-insensitive comparison: models reformat indentation freely, and a
 * re-indent is not a reason to throw away a real convention.
 */
function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

/** Brackets, separators and operators only — no identifier, no literal. */
const PUNCTUATION_ONLY = /^[\s{}()[\]<>;,.:+\-*/%&|!?=~^'"`]*$/;

/**
 * Does this line prove anything on its own? A snippet needs at least one line
 * that is neither punctuation nor a bare keyword, otherwise it matches almost
 * any region of almost any file.
 */
function isInformative(line: string): boolean {
  return line.length >= MIN_INFORMATIVE_CHARS && !PUNCTUATION_ONLY.test(line);
}

/** `needle` appears in `haystack` as consecutive, whole, in-order lines. */
function containsRun(haystack: string[], needle: string[]): boolean {
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let matched = true;
    for (let k = 0; k < needle.length; k++) {
      if (haystack[i + k] !== needle[k]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}
