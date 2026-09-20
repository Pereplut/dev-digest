/** Pure presentation logic for a convention card. No React, no i18n strings. */
import type { ConventionCandidate } from "@devdigest/shared";

/**
 * Confidence bar colour, using the same thresholds the kit's `ConfidenceNum`
 * applies, so a bar and a number never disagree about what "high" means.
 */
export function confidenceColor(confidence: number): string {
  const pct = Math.round(confidence * 100);
  if (pct >= 85) return "var(--ok)";
  if (pct >= 65) return "var(--warn)";
  return "var(--text-muted)";
}

export function confidencePercent(confidence: number): number {
  return Math.round(confidence * 100);
}

/** `src/api/users.ts:23-31`, or `…:23` for a single line, or the bare path. */
export function formatLocation(c: Pick<ConventionCandidate, "evidence_path" | "evidence_start_line" | "evidence_end_line">): string {
  if (c.evidence_start_line === null) return c.evidence_path;
  if (c.evidence_end_line === null || c.evidence_end_line === c.evidence_start_line) {
    return `${c.evidence_path}:${c.evidence_start_line}`;
  }
  return `${c.evidence_path}:${c.evidence_start_line}-${c.evidence_end_line}`;
}

/** The i18n KEY for a rejection reason, or null when the reason is unknown. */
export function rejectReasonKey(reason: string | null): string | null {
  if (!reason) return null;
  const known = ["file_not_found", "line_out_of_range", "snippet_not_found"];
  return known.includes(reason) ? `card.reason.${reason}` : null;
}
