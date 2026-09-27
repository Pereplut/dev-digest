import type { SmartDiff, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import { classifyFile, normalizePath } from './classify.js';
import { ROLE_ORDER } from './constants.js';

/**
 * Smart Diff projection (pure — no DB, no `this`).
 *
 * Turns the PR's files plus the latest review's findings into the SmartDiff
 * contract. Deliberately takes plain shapes, not DB rows, so the whole thing
 * unit-tests without Postgres.
 */

export interface SmartDiffInputFile {
  path: string;
  additions: number | null;
  deletions: number | null;
}

export interface SmartDiffInputFinding {
  file: string;
  startLine: number;
}

/** Lines of the findings that belong to `path`, deduped and ascending. */
function findingLinesFor(path: string, byFile: Map<string, number[]>): number[] {
  const lines = byFile.get(normalizePath(path));
  if (!lines) return [];
  return [...new Set(lines)].sort((a, b) => a - b);
}

/**
 * Group the PR's files by role.
 *
 * File order WITHIN a group is the incoming order — GitHub's — which is what
 * makes the client's "Original order" a pure re-flattening rather than a second
 * sort. Empty groups are omitted: an empty "Docs" header reads as a bug.
 * `split_suggestion` is filled minimally; nothing consumes it yet (spec 0010).
 */
export function buildSmartDiff(
  files: SmartDiffInputFile[],
  findings: SmartDiffInputFinding[],
): SmartDiff {
  // Push into the existing array rather than rebuilding it per element: spreading
  // in a loop is O(N^2) allocations, and a big PR is exactly when this runs.
  const byFile = new Map<string, number[]>();
  for (const f of findings) {
    const key = normalizePath(f.file);
    const lines = byFile.get(key);
    if (lines) lines.push(f.startLine);
    else byFile.set(key, [f.startLine]);
  }

  const buckets = new Map<SmartDiffRole, SmartDiffGroup['files']>();
  let totalLines = 0;
  for (const file of files) {
    const additions = file.additions ?? 0;
    const deletions = file.deletions ?? 0;
    totalLines += additions + deletions;
    const role = classifyFile(file.path);
    const entry = {
      path: file.path,
      additions,
      deletions,
      finding_lines: findingLinesFor(file.path, byFile),
    };
    const bucket = buckets.get(role);
    if (bucket) bucket.push(entry);
    else buckets.set(role, [entry]);
  }

  const groups: SmartDiffGroup[] = [];
  for (const role of ROLE_ORDER) {
    const bucket = buckets.get(role);
    if (bucket && bucket.length > 0) groups.push({ role, files: bucket });
  }

  return {
    groups,
    split_suggestion: { too_big: false, total_lines: totalLines, proposed_splits: [] },
  };
}
