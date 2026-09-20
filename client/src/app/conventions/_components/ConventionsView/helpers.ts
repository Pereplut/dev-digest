/** Pure selectors for the Conventions page. No React, no i18n strings. */
import type { ConventionCandidate, ConventionScan } from "@devdigest/shared";

export interface Partitioned {
  /** Accepted or still undecided — what the list shows by default. */
  visible: ConventionCandidate[];
  /** Explicitly rejected, or rejected by the proof step. Hidden behind a toggle. */
  rejected: ConventionCandidate[];
}

export function partition(candidates: ConventionCandidate[]): Partitioned {
  return {
    visible: candidates.filter((c) => c.status !== "rejected"),
    rejected: candidates.filter((c) => c.status === "rejected"),
  };
}

export function countAccepted(candidates: ConventionCandidate[]): number {
  return candidates.filter((c) => c.status === "accepted").length;
}

export function acceptedIds(candidates: ConventionCandidate[]): string[] {
  return candidates.filter((c) => c.status === "accepted").map((c) => c.id);
}

/** A scan the page should keep polling for. */
export function isRunning(scan: ConventionScan | null | undefined): boolean {
  return scan?.status === "running";
}

/** Short relative age, e.g. "1h ago". Returns null when there is nothing to show. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
