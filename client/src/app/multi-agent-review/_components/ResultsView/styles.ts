import type { CSSProperties } from "react";

export const s = {
  page: { padding: "20px 32px 44px", display: "flex", flexDirection: "column", gap: 22 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" } satisfies CSSProperties,
  h1: { fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  sub: { fontSize: 13, color: "var(--text-muted)", flex: 1 } satisfies CSSProperties,
  configure: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    textDecoration: "none",
    padding: "5px 9px",
    border: "1px solid var(--border)",
    borderRadius: 6,
  } satisfies CSSProperties,
  toggle: {
    display: "inline-flex",
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
  } satisfies CSSProperties,
  toggleBtn: (on: boolean): CSSProperties => ({
    border: "none",
    cursor: "pointer",
    padding: "5px 12px",
    fontSize: 12.5,
    fontWeight: on ? 600 : 500,
    background: on ? "var(--bg-hover)" : "transparent",
    color: on ? "var(--text-primary)" : "var(--text-muted)",
  }),
  prRow: { display: "flex", alignItems: "center", gap: 10, fontSize: 13 } satisfies CSSProperties,
  prNumber: { color: "var(--text-muted)" } satisfies CSSProperties,
  prTitle: { fontWeight: 600, flex: 1 } satisfies CSSProperties,
  totals: { color: "var(--text-muted)", fontSize: 12.5 } satisfies CSSProperties,
  center: { padding: "28px 32px" } satisfies CSSProperties,
};
