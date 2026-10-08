import type { CSSProperties } from "react";

/** Co-located styles for CaseDetailDialog. */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 8, listStyle: "none", margin: 0, padding: "16px 20px" } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px",
    border: "1px solid var(--border)",
    borderRadius: 7,
    background: "var(--bg-elevated)",
    minWidth: 0,
  } satisfies CSSProperties,
  name: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  pass: (pass: boolean | null): CSSProperties => ({
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 700,
    color: pass === true ? "var(--ok)" : pass === false ? "var(--crit)" : "var(--text-muted)",
  }),
  metric: { flexShrink: 0, fontSize: 12, color: "var(--text-secondary)", width: 44, textAlign: "right" } satisfies CSSProperties,
  note: { padding: "0 20px 12px", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  loading: { padding: "16px 20px" } satisfies CSSProperties,
} as const;
