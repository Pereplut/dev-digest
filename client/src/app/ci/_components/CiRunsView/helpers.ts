/** Placeholder for a value a run does not have (never `0`). */
export const NO_VALUE = "—";

/** `duration_ms` -> "850ms" / "12s" / "1m 23s"; null -> placeholder. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return NO_VALUE;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${m}m` : `${m}m ${rest}s`;
}

/** ISO -> short locale timestamp; invalid -> placeholder. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return NO_VALUE;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? NO_VALUE : d.toLocaleString();
}

export function formatPr(prNumber: number | null): string {
  return prNumber == null ? NO_VALUE : `#${prNumber}`;
}
