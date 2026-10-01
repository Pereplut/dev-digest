import type { CSSProperties } from "react";

/** Co-located styles for the onboarding tour page. */
export const s = {
  pageHeader: {
    padding: "24px 32px 10px",
    display: "flex",
    alignItems: "flex-end",
    gap: 16,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  pageTitle: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  } satisfies CSSProperties,
  pageSubtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    marginTop: 4,
  } satisfies CSSProperties,
  headerActions: {
    marginLeft: "auto",
    display: "flex",
    gap: 10,
    alignItems: "center",
  } satisfies CSSProperties,
  statusBar: (tone: "warn" | "crit" | "muted"): CSSProperties => ({
    margin: "0 32px 14px",
    padding: "10px 14px",
    borderRadius: 8,
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    border: `1px solid ${tone === "crit" ? "var(--crit)" : tone === "warn" ? "var(--warn)" : "var(--border)"}`,
    background: tone === "crit" ? "var(--crit-bg)" : tone === "warn" ? "var(--warn-bg)" : "var(--bg-hover)",
    color: tone === "muted" ? "var(--text-secondary)" : "var(--text-primary)",
  }),
  layout: {
    display: "flex",
    gap: 24,
    padding: "0 32px 44px",
    alignItems: "flex-start",
  } satisfies CSSProperties,
  main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  loadingStack: { padding: "0 32px 44px", display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
} as const;
