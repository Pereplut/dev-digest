import type { CSSProperties } from "react";

/** Co-located styles for EvalsTab. */
export const s = {
  wrap: { maxWidth: 900 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  tiles: { display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 } satisfies CSSProperties,
  // Layout non-functional: tiles wrap at phone width (flex + flexWrap above);
  // each MetricCard is flex:1 already (vendored kit), so no fixed width here.
  list: { display: "flex", flexDirection: "column", gap: 8, listStyle: "none", margin: 0, padding: 0 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    minWidth: 0,
  } satisfies CSSProperties,
  // Long / RTL / emoji case names truncate with an ellipsis rather than
  // overflowing the row (## Non-functional, Layout).
  name: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  range: {
    flexShrink: 0,
    maxWidth: 260,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  // Pass state is conveyed by TEXT (Pass/Fail/Not run) as well as colour
  // (WCAG 1.4.1) — colour is decoration here, never the only signal.
  pass: (pass: boolean | null): CSSProperties => ({
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 700,
    color: pass === true ? "var(--ok)" : pass === false ? "var(--crit)" : "var(--text-muted)",
  }),
  empty: { fontSize: 13, color: "var(--text-muted)", padding: "12px 0" } satisfies CSSProperties,
  confirmFooter: { display: "flex", justifyContent: "flex-end", gap: 8 } satisfies CSSProperties,
  // spec 0020 — the per-agent dashboard + recent-runs table.
  dashboardSection: {
    marginTop: 28,
    paddingTop: 20,
    borderTop: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  h3: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  alertBanner: {
    padding: "10px 14px",
    borderRadius: 7,
    background: "var(--crit-bg)",
    color: "var(--crit)",
    fontSize: 13,
    fontWeight: 600,
  } satisfies CSSProperties,
  trendNote: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  recentRunsHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  } satisfies CSSProperties,
} as const;
