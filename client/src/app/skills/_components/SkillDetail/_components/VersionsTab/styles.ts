import type { CSSProperties } from "react";
import type { DiffKind } from "./helpers";

const DIFF_BG: Record<DiffKind, string> = { add: "var(--ok-bg)", del: "var(--crit-bg)", same: "transparent" };
const DIFF_FG: Record<DiffKind, string> = {
  add: "var(--ok)",
  del: "var(--crit)",
  same: "var(--text-secondary)",
};

/** Co-located styles for VersionsTab. */
export const s = {
  wrap: { maxWidth: 1100 } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  hint: { fontSize: 14, color: "var(--text-muted)", marginTop: 6, marginBottom: 18 } satisfies CSSProperties,
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 16px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  versionPill: (current: boolean): CSSProperties => ({
    minWidth: 36,
    textAlign: "center",
    padding: "4px 8px",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    background: current ? "var(--accent-bg)" : "var(--bg-hover)",
    color: current ? "var(--accent)" : "var(--text-secondary)",
  }),
  rowText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  message: { fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  date: { fontSize: 12, color: "var(--text-muted)", marginTop: 3 } satisfies CSSProperties,
  actions: { display: "flex", gap: 8 } satisfies CSSProperties,
  diffBox: { padding: "12px 0", fontSize: 13, lineHeight: 1.6 } satisfies CSSProperties,
  diffRow: (kind: DiffKind): CSSProperties => ({
    display: "flex",
    gap: 12,
    padding: "0 20px",
    background: DIFF_BG[kind],
    color: DIFF_FG[kind],
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  }),
  diffMark: { width: 10, flexShrink: 0, userSelect: "none" } satisfies CSSProperties,
  diffEmpty: { padding: "16px 20px", fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
