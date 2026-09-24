/* findings.ts — placing review findings on diff lines. The sibling of
   comments.ts, and deliberately the same shape: build a key per finding, split
   them into the ones a rendered line can host and the ones it cannot, and let
   the caller decide what a finding LOOKS like.

   This file (and the whole diff-viewer) knows nothing about FindingCard: the
   viewer is a shared component and must not import a route's _components/. The
   `render` callback is that seam. */
import type React from "react";
import { FINDING_SEVERITIES, type FindingSeverity } from "@/components/findings-summary";
import type { Line } from "./helpers";

/**
 * The minimum a finding must expose for the viewer to place it. `FindingRecord`
 * satisfies this structurally, so the tab passes the real records straight in and
 * its `render` closes over the full object by id.
 *
 * `severity` is the union, not `string`: widening it would force every consumer
 * to assert it back to index the colour table, and an unchecked assertion is
 * exactly how an unhandled severity becomes a silent fallback instead of a
 * compile error.
 */
export interface DiffFindingLike {
  id: string;
  file: string;
  start_line: number;
  severity: FindingSeverity;
}

export interface DiffFindingApi {
  findings: DiffFindingLike[];
  /** Hidden by the same control that hides GitHub comments (spec 0010, AC 13). */
  showFindings: boolean;
  render: (f: DiffFindingLike) => React.ReactNode;
}

/**
 * Repo-relative form for comparing a finding's `file` with a `PrFile.path`.
 * A model may cite `./src/a.ts`, and a path lifted out of a diff header carries
 * an `a/` or `b/` prefix; both must still match the file they belong to.
 * If a real run turns up another spelling, widen it HERE, never at a call site.
 */
export function normalizeFindingPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^\.\//, "")
    .replace(/^[ab]\//, "");
}

/**
 * Findings anchor to the NEW line only. `finding.start_line` is a line in the
 * post-image, so `RIGHT:<n>` — there is no side field to read, and guessing a
 * `LEFT:` match would put the card on unrelated code.
 */
export function keyForFinding(f: DiffFindingLike): string {
  return `RIGHT:${f.start_line}`;
}

/** Only the RIGHT key of a line can host a finding (see keyForFinding). */
export function findingKeyForLine(ln: Line): string | null {
  if (ln.kind !== "add" && ln.kind !== "ctx") return null;
  return ln.newNo != null ? `RIGHT:${ln.newNo}` : null;
}

/** The findings that belong to one file, whatever spelling their path uses. */
export function findingsForFile(
  findings: DiffFindingLike[] | undefined,
  path: string,
): DiffFindingLike[] {
  if (!findings || findings.length === 0) return [];
  const want = normalizeFindingPath(path);
  return findings.filter((f) => normalizeFindingPath(f.file) === want);
}

/**
 * Split a file's findings into those a rendered line can host and those it
 * cannot — a line outside the patch, or a finding on a deleted line. The
 * off-patch bucket is rendered at the foot of the file, exactly as outdated
 * comments are, so a finding is never silently dropped (spec 0010, AC 12).
 */
export function partitionFindings(
  findings: DiffFindingLike[],
  renderedKeys: Set<string>,
): { matched: Map<string, DiffFindingLike[]>; offPatch: DiffFindingLike[] } {
  const matched = new Map<string, DiffFindingLike[]>();
  const offPatch: DiffFindingLike[] = [];
  for (const f of findings) {
    const key = keyForFinding(f);
    if (renderedKeys.has(key)) {
      const list = matched.get(key) ?? [];
      list.push(f);
      matched.set(key, list);
    } else {
      offPatch.push(f);
    }
  }
  return { matched, offPatch };
}

/**
 * The severity a line is marked with: the worst one on it.
 *
 * Ranking comes from `FINDING_SEVERITIES` (declared worst-first), not a second
 * table here — that ordering is one domain rule and `findings-summary` already
 * owns it.
 */
export function worstSeverity(findings: DiffFindingLike[]): FindingSeverity | null {
  let worst: FindingSeverity | null = null;
  let worstRank: number = FINDING_SEVERITIES.length;
  for (const f of findings) {
    const rank = FINDING_SEVERITIES.indexOf(f.severity);
    if (rank !== -1 && rank < worstRank) {
      worst = f.severity;
      worstRank = rank;
    }
  }
  return worst;
}
