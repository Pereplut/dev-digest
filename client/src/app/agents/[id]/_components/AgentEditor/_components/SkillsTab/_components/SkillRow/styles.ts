import type { CSSProperties } from "react";

/** Co-located styles for one sortable skill row. */
export const s = {
  row: (checked: boolean, dragging: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: checked ? "var(--bg-hover)" : "var(--bg-elevated)",
    opacity: dragging ? 0.6 : 1,
    position: "relative",
    zIndex: dragging ? 1 : undefined,
  }),
  handle: (disabled: boolean): CSSProperties => ({
    display: "inline-flex",
    padding: 2,
    border: "none",
    background: "none",
    color: "var(--text-muted)",
    cursor: disabled ? "not-allowed" : "grab",
    opacity: disabled ? 0.35 : 1,
    touchAction: "none",
  }),
  name: (muted: boolean): CSSProperties => ({
    fontSize: 14,
    fontWeight: 600,
    color: muted ? "var(--text-muted)" : "var(--text-primary)",
  }),
  offNote: { fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" } satisfies CSSProperties,
  badge: { marginLeft: "auto" } satisfies CSSProperties,
} as const;
