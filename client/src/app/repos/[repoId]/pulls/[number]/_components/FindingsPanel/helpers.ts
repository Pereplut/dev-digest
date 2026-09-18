import type { FindingRecord } from "@devdigest/shared";
import type { FindingSeverity } from "@/components/findings-summary";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/** Optionally drop low-confidence findings and sort by severity. */
export function visibleFindings(findings: FindingRecord[], hideLow: boolean): FindingRecord[] {
  let shown = findings;
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}

/** Keep only one severity (the clicked pill); `null` = no filter. */
export function filterBySeverity(
  findings: FindingRecord[],
  severity: FindingSeverity | null,
): FindingRecord[] {
  return severity ? findings.filter((f) => f.severity === severity) : findings;
}
