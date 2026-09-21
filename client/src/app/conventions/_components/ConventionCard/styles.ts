import type { CSSProperties } from "react";

export const s = {
  /** The accepted state is what the green left border signals. */
  card: (accepted: boolean, dimmed: boolean): CSSProperties => ({
    display: "flex",
    gap: 16,
    alignItems: "flex-start",
    padding: 16,
    borderRadius: 10,
    border: "1px solid var(--border)",
    borderLeft: accepted ? "3px solid var(--ok)" : "3px solid transparent",
    background: "var(--bg-surface)",
    opacity: dimmed ? 0.55 : 1,
  }),

  main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,

  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  rule: {
    margin: 0,
    fontSize: 15,
    fontStyle: "italic",
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  confidenceRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  bar: { width: 140, flexShrink: 0 } satisfies CSSProperties,

  percent: { fontVariantNumeric: "tabular-nums", color: "var(--text-secondary)" } satisfies CSSProperties,

  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: 150,
    flexShrink: 0,
  } satisfies CSSProperties,

  warning: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--warn)",
  } satisfies CSSProperties,

  editRow: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,

  editActions: { display: "flex", gap: 8 } satisfies CSSProperties,
} as const;
