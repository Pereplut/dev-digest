import type { CSSProperties } from "react";

export const s = {
  box: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    marginBottom: 18,
  } satisfies CSSProperties,
  subtitle: {
    fontSize: 12,
    color: "var(--text-secondary)",
    margin: "-8px 0 12px",
  } satisfies CSSProperties,
  loadingRow: {
    fontSize: 13,
    color: "var(--text-secondary)",
    margin: "0 0 10px",
  } satisfies CSSProperties,
  degraded: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 12,
  } satisfies CSSProperties,
  degradedReason: {
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  chips: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    marginBottom: 14,
  } satisfies CSSProperties,
  tree: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  symbolGroup: {
    border: "1px solid var(--border)",
    borderRadius: 6,
  } satisfies CSSProperties,
  symbolHeader: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    background: "none",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    fontSize: 13,
  } satisfies CSSProperties,
  symbolRowStatic: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    fontSize: 13,
  } satisfies CSSProperties,
  chevron: (open: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
    flexShrink: 0,
  }),
  symbolName: {
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--text-primary)",
    fontWeight: 600,
  } satisfies CSSProperties,
  callerBadge: {
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--text-secondary)",
    background: "var(--bg-hover)",
    borderRadius: 10,
    padding: "1px 8px",
  } satisfies CSSProperties,
  noCallers: {
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  symbolBody: {
    padding: "0 10px 12px 31px",
  } satisfies CSSProperties,
  listLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "var(--text-tertiary, var(--text-secondary))",
    margin: "8px 0 4px",
  } satisfies CSSProperties,
  callerList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,
  callerRow: {
    fontSize: 13,
  } satisfies CSSProperties,
  capped: {
    fontSize: 11,
    color: "var(--text-muted)",
    margin: "6px 0 0",
  } satisfies CSSProperties,
} as const;
