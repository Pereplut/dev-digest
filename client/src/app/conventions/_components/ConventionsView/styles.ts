import type { CSSProperties } from "react";

export const s = {
  page: {
    maxWidth: 1080,
    margin: "0 auto",
    padding: "28px 32px 64px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
  } satisfies CSSProperties,

  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  title: {
    margin: 0,
    fontSize: 26,
    fontWeight: 700,
    color: "var(--text-primary)",
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  repoName: { color: "var(--accent)", fontSize: 24 } satisfies CSSProperties,

  subtitle: { margin: "8px 0 0", fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,

  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  counter: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,

  spacer: { flex: 1 } satisfies CSSProperties,

  list: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,

  notice: {
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  failed: {
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    fontSize: 12.5,
    color: "var(--crit)",
  } satisfies CSSProperties,

  rejectedHeading: {
    marginTop: 8,
    fontSize: 12.5,
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
} as const;
