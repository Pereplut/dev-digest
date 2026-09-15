import type { CSSProperties } from "react";

/** Co-located styles for FindingsPanel (extracted from inline styles). */
export const s = {
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  divider: {
    width: 1,
    height: 18,
    background: "var(--border)",
    margin: "0 2px",
  } satisfies CSSProperties,
  // "N CRITICAL · N WARNING · N SUGGESTION" — each pill toggles a severity filter.
  pills: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  pillSep: { color: "var(--text-muted)", fontSize: 12 } satisfies CSSProperties,
  pill: (active: boolean, color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 10px",
    borderRadius: 999,
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: active ? color : "var(--border)",
    background: active ? "var(--bg-hover)" : "transparent",
    color,
    font: "inherit",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    cursor: "pointer",
  }),
  toggleGroup: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
} as const;
