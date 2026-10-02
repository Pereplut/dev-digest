/**
 * Risk severity, mirrored LOCALLY rather than importing `RiskSeverity` as a
 * VALUE from `@devdigest/shared` — a value import (even of a plain union)
 * passes typecheck and vitest but breaks `next build`, because the vendored
 * contracts barrel re-exports with `.js` specifiers webpack cannot resolve
 * (client/INSIGHTS.md, 2026-09-19). Mirrors
 * `server/src/vendor/shared/contracts/brief.ts`'s `RiskSeverity` enum.
 *
 * Not the same palette as `PrIntentCard/constants.ts`'s `CONFIDENCE_STYLE`:
 * there `high` is the GOOD band (green, for confidence). Here `high` is the
 * WORST band (red, for risk) — the two must not share a style map.
 */
export const RISK_SEVERITIES = ["high", "medium", "low"] as const;
export type RiskSeverityLocal = (typeof RISK_SEVERITIES)[number];

/** Decoration only — the band is always spelled out in text (AC-37). */
export const SEVERITY_STYLE: Record<RiskSeverityLocal, { color: string }> = {
  high: { color: "var(--crit)" },
  medium: { color: "var(--warn)" },
  low: { color: "var(--text-muted)" },
};
