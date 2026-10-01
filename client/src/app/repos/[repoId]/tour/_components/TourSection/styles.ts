import type { CSSProperties } from "react";

/** Co-located styles for one collapsible tour section. */
export const s = {
  section: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  header: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "14px 18px",
    background: "none",
    border: "none",
    font: "inherit",
    color: "inherit",
    textAlign: "left",
    cursor: "pointer",
  } satisfies CSSProperties,
  title: { fontSize: 15, fontWeight: 650, flex: 1 } satisfies CSSProperties,
  body: { padding: "0 18px 18px", fontSize: 13.5, color: "var(--text-primary)" } satisfies CSSProperties,
  note: {
    margin: "0 0 10px",
    fontSize: 12.5,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  list: { margin: "8px 0 0", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  diagramUnavailable: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 8 } satisfies CSSProperties,
} as const;
