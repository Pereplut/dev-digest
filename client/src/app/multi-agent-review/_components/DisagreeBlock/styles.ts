import type { CSSProperties } from "react";

export const s = {
  root: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", justifyContent: "space-between" } satisfies CSSProperties,
  title: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  toggle: { display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  group: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
  } satisfies CSSProperties,
  groupHead: { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" } satisfies CSSProperties,
  location: { fontSize: 12, color: "var(--text-secondary)", wordBreak: "break-all" } satisfies CSSProperties,
  groupTitle: { fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0 } satisfies CSSProperties,
  expandBtn: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    color: "var(--text-muted)",
    padding: 4,
    display: "grid",
    placeItems: "center",
  } satisfies CSSProperties,
  takes: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  take: { display: "flex", flexDirection: "column", gap: 4, padding: "10px 14px" } satisfies CSSProperties,
  takeAgent: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  note: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  expanded: { display: "flex", flexDirection: "column", gap: 14, padding: 14, borderTop: "1px solid var(--border)" } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
};
