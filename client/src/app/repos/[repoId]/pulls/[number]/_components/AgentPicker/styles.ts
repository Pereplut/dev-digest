import type { CSSProperties } from "react";
import { PANEL_WIDTH } from "./constants";

/** Co-located styles for AgentPicker. */
export const s = {
  root: { position: "relative", display: "inline-block" } satisfies CSSProperties,
  panel: {
    position: "absolute",
    right: 0,
    top: "calc(100% + 6px)",
    width: PANEL_WIDTH,
    zIndex: 30,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,.35)",
  } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  title: {
    flex: 1,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  textBtn: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--accent)",
    padding: 0,
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  rowLabel: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  hint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  warn: { fontSize: 12, color: "var(--warn)" } satisfies CSSProperties,
  configure: {
    fontSize: 12,
    color: "var(--text-muted)",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
};
