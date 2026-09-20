import type { CSSProperties } from "react";

export const s = {
  banner: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--accent-bg)",
    background: "var(--accent-bg)",
    color: "var(--text-secondary)",
    fontSize: 13,
    lineHeight: 1.5,
  } satisfies CSSProperties,

  form: { display: "flex", flexDirection: "column", gap: 16, marginTop: 16 } satisfies CSSProperties,

  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 } satisfies CSSProperties,

  bodyHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "7px 10px",
    border: "1px solid var(--border)",
    borderBottom: "none",
    borderRadius: "8px 8px 0 0",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,

  fileName: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  tokens: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,

  previewBox: {
    border: "1px solid var(--border)",
    borderTop: "none",
    borderRadius: "0 0 8px 8px",
    padding: "12px 14px",
    minHeight: 240,
    maxHeight: 360,
    overflow: "auto",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,

  previewEmpty: { color: "var(--text-muted)", fontSize: 13 } satisfies CSSProperties,

  enabledHint: { fontSize: 12, color: "var(--text-muted)", marginTop: 6 } satisfies CSSProperties,

  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    width: "100%",
  } satisfies CSSProperties,

  footerNote: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  footerActions: { display: "flex", gap: 8 } satisfies CSSProperties,

  error: { color: "var(--crit)", fontSize: 12, marginTop: 5 } satisfies CSSProperties,

  toggleRow: { display: "inline-flex", alignItems: "center", gap: 8 } satisfies CSSProperties,

  /** The kit Toggle takes no aria-label, so its accessible name comes from this. */
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
  } satisfies CSSProperties,
} as const;
