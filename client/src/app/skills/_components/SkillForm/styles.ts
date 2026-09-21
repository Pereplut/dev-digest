import type { CSSProperties } from "react";

/** Co-located styles for SkillForm. */
export const s = {
  wrap: { maxWidth: 820 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700, marginBottom: 20 } satisfies CSSProperties,
  fieldError: { fontSize: 12, color: "var(--crit)", marginTop: 6 } satisfies CSSProperties,
  modeSwitch: { display: "inline-flex", gap: 4 } satisfies CSSProperties,
  previewBox: {
    border: "1px solid var(--border-strong)",
    borderRadius: 7,
    background: "var(--bg-elevated)",
    padding: "12px 16px",
    minHeight: 200,
    fontSize: 14,
  } satisfies CSSProperties,
  previewEmpty: { color: "var(--text-muted)", fontSize: 13 } satisfies CSSProperties,
  serverError: {
    fontSize: 13,
    color: "var(--crit)",
    background: "var(--crit-bg)",
    borderRadius: 7,
    padding: "10px 12px",
    marginBottom: 16,
  } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 10, marginTop: 10 } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
} as const;
