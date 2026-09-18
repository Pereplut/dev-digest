/* findings-summary helpers — pure counting/sorting of review findings for the
   PR list FINDINGS column and the Agent runs timeline (spec 0002). */
import type { FindingRecord, FindingsCounts, ReviewRecord } from "@devdigest/shared";

/** Severities that get a chip, worst first. */
export const FINDING_SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/** Open = not dismissed (accepted findings still count). */
export function isOpenFinding(f: Pick<FindingRecord, "dismissed_at">): boolean {
  return f.dismissed_at == null;
}

/** Tally findings per severity; unknown severities are ignored. */
export function countBySeverity(findings: Pick<FindingRecord, "severity">[]): FindingsCounts {
  const c: FindingsCounts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) {
    if ((FINDING_SEVERITIES as readonly string[]).includes(f.severity)) c[f.severity as FindingSeverity] += 1;
  }
  return c;
}

export function totalFindings(counts: FindingsCounts | null | undefined): number {
  return counts ? counts.CRITICAL + counts.WARNING + counts.SUGGESTION : 0;
}

/** Sorted CRITICAL → WARNING → SUGGESTION (unknown last); stable within a severity. */
export function sortBySeverity<T extends Pick<FindingRecord, "severity">>(findings: T[]): T[] {
  const rank = (sev: string) => {
    const i = (FINDING_SEVERITIES as readonly string[]).indexOf(sev);
    return i === -1 ? FINDING_SEVERITIES.length : i;
  };
  return [...findings].sort((a, b) => rank(a.severity) - rank(b.severity));
}

/** "12" for a single line, else "45-52". */
export function lineRange(f: Pick<FindingRecord, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}

/** Open findings per run id, from each run's `review` (summary reviews ignored). */
export function openFindingsByRun(reviews: ReviewRecord[]): Map<string, FindingRecord[]> {
  const map = new Map<string, FindingRecord[]>();
  for (const rv of reviews) {
    if (!rv.run_id || rv.kind !== "review") continue;
    map.set(rv.run_id, sortBySeverity([...(map.get(rv.run_id) ?? []), ...rv.findings.filter(isOpenFinding)]));
  }
  return map;
}

/** Open findings of one run — the PR list's latest run with a review. */
export function runFindings(reviews: ReviewRecord[], runId: string | null | undefined): FindingRecord[] {
  if (!runId) return [];
  return openFindingsByRun(reviews).get(runId) ?? [];
}
