import type { BlastRadius, Risk, ReviewFocusItem } from '@devdigest/shared';
import { TRUNCATION_ORDER, type FactBlockName } from './constants.js';

/**
 * Pure grounding + budget helpers for the PR Brief (spec 0018). No DB, no
 * container, no `this` — @devdigest/shared types and stdlib only, so this
 * file unit-tests without Postgres and without a tokenizer. Wrapping
 * (`wrapUntrusted`) and message assembly belong in `prompt.ts`; this file
 * only computes which facts fit and which paths survive.
 */

// ---------------------------------------------------------------------------
// Path normalisation + grounding (AC-8, AC-9, AC-10, AC-11, AC-52)
// ---------------------------------------------------------------------------

/**
 * Normalise a path for grounding comparison: strip ONE leading `./` and
 * collapse repeated `/`. The remainder compares case-sensitively (AC-11) —
 * that is what the index and GitHub both use, so a case-only mismatch is
 * left ungrounded rather than silently repaired.
 */
export function normalizePath(path: string): string {
  const stripped = path.startsWith('./') ? path.slice(2) : path;
  return stripped.replace(/\/{2,}/g, '/');
}

/**
 * The grounding set: every path the model is allowed to cite. C13 — blast
 * data is consumed as a set of file PATHS only, never a bare symbol name
 * (`renderWithIntl` is declared in 8 files in this repo). Union of the PR's
 * own files, every changed symbol's declaring file, every downstream
 * group's file, and every caller's file.
 */
export function groundingPaths(
  files: { path: string }[],
  blast: BlastRadius,
): Set<string> {
  const set = new Set<string>();
  for (const f of files) set.add(normalizePath(f.path));
  for (const sym of blast.changed_symbols) set.add(normalizePath(sym.file));
  for (const d of blast.downstream) {
    set.add(normalizePath(d.file));
    for (const c of d.callers) set.add(normalizePath(c.file));
  }
  return set;
}

export interface GroundedBrief {
  risks: Risk[];
  review_focus: ReviewFocusItem[];
  dropped_risks: number;
  dropped_focus: number;
}

/**
 * Filter the model's response against the grounding set, before anything is
 * persisted (AC-10). A risk loses an ungrounded `file_refs` entry but
 * survives with the rest (AC-9); a risk left with none is dropped entirely.
 * A review-focus item is dropped outright when its `file` is ungrounded or
 * its `line` is `< 1` (AC-8, AC-52).
 */
export function groundBrief(
  model: { risks: Risk[]; review_focus: ReviewFocusItem[] },
  paths: Set<string>,
): GroundedBrief {
  let dropped_risks = 0;
  const risks: Risk[] = [];
  for (const risk of model.risks) {
    const file_refs = risk.file_refs.filter((ref) => paths.has(normalizePath(ref)));
    if (file_refs.length === 0) {
      dropped_risks++;
      continue;
    }
    risks.push({ ...risk, file_refs });
  }

  let dropped_focus = 0;
  const review_focus: ReviewFocusItem[] = [];
  for (const item of model.review_focus) {
    if (item.line < 1 || !paths.has(normalizePath(item.file))) {
      dropped_focus++;
      continue;
    }
    review_focus.push(item);
  }

  return { risks, review_focus, dropped_risks, dropped_focus };
}

// ---------------------------------------------------------------------------
// Fact blocks + budget (AC-4, AC-5)
// ---------------------------------------------------------------------------

export interface FactBlock {
  name: FactBlockName;
  text: string;
}

/** Raw facts the droppable blocks are built from. Never-dropped facts
 *  (intent, PR title, the blast `summary`) are not here — they are counted
 *  as fixed overhead by the caller, never as a droppable block. */
export interface BriefFactInput {
  prBody: string;
  issueRef: string | null;
  specPaths: string[];
  files: { path: string; additions: number; deletions: number }[];
  /** `file:line symbol` lines, one per blast caller — droppable, unlike the
   *  blast `summary` string itself. */
  blastCallerLines: string[];
  /** One line per file, grouped by Smart Diff role. */
  smartDiffLines: string[];
}

/**
 * Build the six droppable fact blocks, omitting any whose input is empty —
 * an empty block would read as a bug, not a fact (mirrors
 * `smart-diff/helpers.ts`'s "empty groups are omitted" rule).
 */
export function buildFactBlocks(input: BriefFactInput): FactBlock[] {
  const blocks: FactBlock[] = [];
  if (input.specPaths.length > 0) {
    blocks.push({ name: 'specs', text: input.specPaths.join('\n') });
  }
  if (input.smartDiffLines.length > 0) {
    blocks.push({ name: 'smart_diff', text: input.smartDiffLines.join('\n') });
  }
  if (input.blastCallerLines.length > 0) {
    blocks.push({ name: 'blast_callers', text: input.blastCallerLines.join('\n') });
  }
  if (input.issueRef) {
    blocks.push({ name: 'issue', text: input.issueRef });
  }
  if (input.prBody) {
    blocks.push({ name: 'pr_body', text: input.prBody });
  }
  if (input.files.length > 0) {
    blocks.push({
      name: 'diff_stats',
      text: input.files.map((f) => `${f.path} +${f.additions}/-${f.deletions}`).join('\n'),
    });
  }
  return blocks;
}

export interface BudgetResult {
  kept: FactBlock[];
  droppedNames: FactBlockName[];
}

/**
 * Drop whole blocks, lowest-priority first (`TRUNCATION_ORDER`), until the
 * total — `overheadTokens` (the never-dropped facts + the system message)
 * plus every remaining block's tokens — fits `limit`, or nothing droppable
 * is left. `countTokens` is injected so this stays pure (ring 1): the real
 * caller passes `container.tokenizer.count`.
 */
export function applyBudget(
  blocks: FactBlock[],
  overheadTokens: number,
  limit: number,
  countTokens: (text: string) => number,
): BudgetResult {
  const tokensByName = new Map<FactBlockName, number>(
    blocks.map((b) => [b.name, countTokens(b.text)]),
  );
  let total = overheadTokens;
  for (const tokens of tokensByName.values()) total += tokens;

  const dropped = new Set<FactBlockName>();
  for (const name of TRUNCATION_ORDER) {
    if (total <= limit) break;
    const tokens = tokensByName.get(name);
    if (tokens === undefined) continue; // block wasn't present at all
    dropped.add(name);
    total -= tokens;
  }

  return {
    kept: blocks.filter((b) => !dropped.has(b.name)),
    droppedNames: [...dropped],
  };
}
