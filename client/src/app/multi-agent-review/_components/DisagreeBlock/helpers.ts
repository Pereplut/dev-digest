import type { AgentColumn, Conflict, FindingRecord } from "@devdigest/shared";

/** `file:start`, or `file:start–end` when the group spans lines. */
export function locationLabel(c: Pick<Conflict, "file" | "start_line" | "end_line">): string {
  return c.end_line !== c.start_line ? `${c.file}:${c.start_line}–${c.end_line}` : `${c.file}:${c.start_line}`;
}

/** Groups to show: all of them, or only those where the agents' verdicts differ. */
export function visibleConflicts(conflicts: Conflict[], onlyConflicts: boolean): Conflict[] {
  return onlyConflicts ? conflicts.filter((c) => c.divergent) : conflicts;
}

/** Resolves a take's `finding_ids` through the columns' full records (ids that do not resolve are dropped). */
export function resolveFindings(
  runId: string,
  findingIds: string[],
  columns: AgentColumn[],
): FindingRecord[] {
  const col = columns.find((c) => c.run_id === runId);
  if (!col) return [];
  const byId = new Map(col.findings.map((f) => [f.id, f]));
  return findingIds.flatMap((id) => {
    const f = byId.get(id);
    return f ? [f] : [];
  });
}
