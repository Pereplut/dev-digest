import type { CSSProperties } from "react";

export const s = {
  box: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    marginBottom: 18,
  } satisfies CSSProperties,
  head: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 10,
  } satisfies CSSProperties,
  purpose: {
    fontSize: 14,
    color: "var(--text-primary)",
    lineHeight: 1.55,
    margin: "0 0 12px",
  } satisfies CSSProperties,
  hint: {
    fontSize: 12,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    margin: "0 0 12px",
  } satisfies CSSProperties,
  listLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "var(--text-tertiary, var(--text-secondary))",
    margin: "0 0 4px",
  } satisfies CSSProperties,
  list: {
    margin: "0 0 12px",
    paddingLeft: 18,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.6,
  } satisfies CSSProperties,
  chips: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    marginTop: 4,
  } satisfies CSSProperties,
  quote: {
    borderLeft: "2px solid var(--border)",
    paddingLeft: 10,
    margin: "6px 0",
    fontSize: 12,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  footer: {
    marginTop: 12,
    fontSize: 11,
    color: "var(--text-tertiary, var(--text-secondary))",
  } satisfies CSSProperties,
} as const;
