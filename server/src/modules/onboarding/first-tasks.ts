/**
 * `first_tasks` assembly (AC-38 to AC-40, AC-66, AC-67). Pure — every input is
 * already-fetched data; no DB, no IO, no container. The three sources, each
 * with the strongest anchor it has:
 *   - open findings            → `file:start_line`
 *   - pending, evidence-valid convention candidates → `id` + `evidence_path:evidence_start_line`
 *   - high-rank files with no sibling test → the bare path, no line number
 *
 * Model prose can never add a task: nothing here is LLM output.
 */
import type { OnboardingItem } from '@devdigest/shared';
import { FIRST_TASKS_LIMIT } from './constants.js';

export interface FirstTasksFinding {
  file: string;
  startLine: number;
}

export interface FirstTasksCandidate {
  id: string;
  evidencePath: string;
  evidenceStartLine: number | null;
}

export interface BuildFirstTasksInput {
  /** Open findings for this repo (`accepted_at IS NULL AND dismissed_at IS NULL`), queried at cap + 1. */
  findings: FirstTasksFinding[];
  /** Pending candidates with `evidence_valid = true`, queried at cap + 1. */
  candidates: FirstTasksCandidate[];
  /** The repo's ranked paths (reused from the reading_path read, decision 14), rank order. */
  rankedPaths: string[];
  /** Repo-relative sibling-test paths that are actually indexed (from `getFileRank`). */
  existingSiblingPaths: ReadonlySet<string>;
}

export interface FirstTasksResult {
  items: OnboardingItem[];
  /** True when the three sources' raw (pre-merge-cap) counts sum past `FIRST_TASKS_LIMIT`. */
  truncated: boolean;
}

/**
 * Same-directory sibling-test candidates for `path` (spec Q4 decision): only
 * `dir/base.test.<e>`, `dir/base.spec.<e>` or `dir/__tests__/base.test.<e>` —
 * no mirrored-tree rule, so `server/src/x.ts` tested by `server/test/x.test.ts`
 * reads as untested. Deliberate (spec Decisions, `:88`).
 */
export function siblingTestCandidates(path: string): string[] {
  const slash = path.lastIndexOf('/');
  const dir = slash === -1 ? '' : path.slice(0, slash);
  const file = slash === -1 ? path : path.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  if (dot <= 0) return [];
  const base = file.slice(0, dot);
  const ext = file.slice(dot + 1);
  const prefix = dir ? `${dir}/` : '';
  const testDir = dir ? `${dir}/__tests__` : '__tests__';
  return [`${prefix}${base}.test.${ext}`, `${prefix}${base}.spec.${ext}`, `${testDir}/${base}.test.${ext}`];
}

function findUntestedFiles(rankedPaths: string[], existingSiblings: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const path of rankedPaths) {
    const candidates = siblingTestCandidates(path);
    if (candidates.length === 0) continue;
    if (!candidates.some((c) => existingSiblings.has(c))) out.push(path);
  }
  return out;
}

export function buildFirstTasks(input: BuildFirstTasksInput): FirstTasksResult {
  const cap = FIRST_TASKS_LIMIT;

  const findingItems: OnboardingItem[] = input.findings.slice(0, cap + 1).map((f) => ({
    text: `Open finding in ${f.file}:${f.startLine}.`,
    anchor: `${f.file}:${f.startLine}`,
  }));

  const candidateItems: OnboardingItem[] = input.candidates.slice(0, cap + 1).map((c) => ({
    text: `Review convention candidate ${c.id} (${c.evidencePath}).`,
    anchor:
      c.evidenceStartLine != null ? `${c.evidencePath}:${c.evidenceStartLine}` : c.evidencePath,
  }));

  const untestedItems: OnboardingItem[] = findUntestedFiles(input.rankedPaths, input.existingSiblingPaths)
    .slice(0, cap + 1)
    .map((path) => ({
      // Bare path, no line number, no trailing ':' (AC-67) — this source has
      // no line to cite and none is fabricated.
      text: `Add a test for ${path}`,
      anchor: path,
    }));

  const merged = [...findingItems, ...candidateItems, ...untestedItems];
  // Each source was already queried/filtered at its own cap + 1, so a merged
  // length past FIRST_TASKS_LIMIT means either one source alone overflowed or
  // three under-cap sources summed past it — both are real truncation
  // (ANSWERED 3), and this single comparison catches both.
  const truncated = merged.length > cap;
  return { items: merged.slice(0, cap), truncated };
}

/** The deterministic statement when all three sources are empty (AC-40). */
export const NO_SIGNALS_STATEMENT =
  'No actionable onboarding signals were found: no open findings, no pending conventions with ' +
  'valid evidence, and no high-rank file without a sibling test.';
