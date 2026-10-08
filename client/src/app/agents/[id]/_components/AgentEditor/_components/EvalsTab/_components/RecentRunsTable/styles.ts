import type { CSSProperties } from "react";
import type { EvalBatchRecord } from "@devdigest/shared";

/** Badge colour per batch status — every status is covered (exhaustive). */
const STATUS_COLOR = {
  queued: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
  running: { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  done: { color: "var(--ok)", bg: "var(--ok-bg)" },
  failed: { color: "var(--crit)", bg: "var(--crit-bg)" },
  cancelled: { color: "var(--text-muted)", bg: "var(--bg-hover)" },
} satisfies Record<EvalBatchRecord["status"], { color: string; bg: string }>;

export function statusBadgeColors(status: EvalBatchRecord["status"]): { color: string; bg: string } {
  return STATUS_COLOR[status];
}

/** Co-located styles for RecentRunsTable. */
export const s = {
  // Horizontal scroll rather than compressed numeric columns (`## Non-functional`, Layout).
  scroll: { overflowX: "auto" } satisfies CSSProperties,
  table: { width: "100%", minWidth: 720, borderCollapse: "collapse" } satisfies CSSProperties,
  headRow: { borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  th: {
    textAlign: "left",
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  row: { borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  td: { padding: "8px 10px", fontSize: 13, whiteSpace: "nowrap" } satisfies CSSProperties,
  nameCell: {
    padding: "8px 10px",
    fontSize: 13,
    whiteSpace: "nowrap",
    maxWidth: 220,
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
} as const;
