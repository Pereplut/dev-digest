import type { CiInstallation } from "@devdigest/shared";
import { NO_VALUE } from "./constants";

/** ISO timestamp -> short locale string; null/invalid -> placeholder. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return NO_VALUE;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? NO_VALUE : d.toLocaleString();
}

/** ISO timestamp -> date only; invalid input is returned unchanged. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

/** "Update CI config" only applies to GitHub Actions installations (AC-60). */
export function hasGhaInstallation(installations: CiInstallation[] | undefined): boolean {
  return (installations ?? []).some((i) => i.target_type === "gha");
}

/** installation id -> repo, for labelling `CiUpdateResult` entries. */
export function repoById(installations: CiInstallation[] | undefined): Map<string, string> {
  return new Map((installations ?? []).map((i) => [i.id, i.repo]));
}

export function prLabel(prNumber: number | null): string {
  return prNumber == null ? NO_VALUE : `#${prNumber}`;
}
