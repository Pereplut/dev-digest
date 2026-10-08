import type { CSSProperties } from "react";
import type { DiffKind } from "@/lib/text-diff";

// Same mapping VersionsTab uses — a diff is a diff regardless of feature.
const DIFF_BG: Record<DiffKind, string> = { add: "var(--ok-bg)", del: "var(--crit-bg)", same: "transparent" };
const DIFF_FG: Record<DiffKind, string> = { add: "var(--ok)", del: "var(--crit)", same: "var(--text-secondary)" };
const DIFF_MARK: Record<DiffKind, string> = { add: "+", del: "-", same: " " };

export { DIFF_MARK };

/** Co-located styles for CompareModal. */
export const s = {
  warning: {
    padding: "10px 14px",
    marginBottom: 14,
    borderRadius: 7,
    background: "var(--warn-bg)",
    color: "var(--warn)",
    fontSize: 13,
  } satisfies CSSProperties,
  tiles: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 } satisfies CSSProperties,
  tile: {
    flex: 1,
    minWidth: 140,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: 14,
  } satisfies CSSProperties,
  tileLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
    marginBottom: 8,
  } satisfies CSSProperties,
  tileRow: { display: "flex", alignItems: "baseline", gap: 6, fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  tileDelta: (color: string): CSSProperties => ({ display: "block", marginTop: 4, fontSize: 12, fontWeight: 600, color }),
  notice: { padding: "14px 2px", fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  diffBox: { padding: "12px 0", fontSize: 13, lineHeight: 1.6, maxHeight: 320, overflow: "auto" } satisfies CSSProperties,
  diffRow: (kind: DiffKind): CSSProperties => ({
    display: "flex",
    gap: 12,
    padding: "0 4px",
    background: DIFF_BG[kind],
    color: DIFF_FG[kind],
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  }),
  diffMark: { width: 10, flexShrink: 0, userSelect: "none" } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
  confirmBody: { fontSize: 14, lineHeight: 1.6 } satisfies CSSProperties,
  error: { color: "var(--crit)", fontSize: 13, marginTop: 10 } satisfies CSSProperties,
  success: { color: "var(--ok)", fontSize: 13, marginRight: "auto" } satisfies CSSProperties,
  loadingBody: { padding: "16px 4px" } satisfies CSSProperties,
} as const;
