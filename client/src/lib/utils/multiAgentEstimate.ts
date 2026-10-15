/* multiAgentEstimate.ts — pure helpers over `Agent.est_duration_ms` / `est_cost_usd`
   (spec 0021, AC-24/31/33). "Has history" means `est_duration_ms != null`. */
import type { Agent } from "@devdigest/shared";

type Estimated = Pick<Agent, "est_duration_ms" | "est_cost_usd">;

export interface EstimateSummary {
  duration_ms: number;
  cost_usd: number | null;
}

export function hasHistory(a: Estimated): boolean {
  return a.est_duration_ms != null;
}

/** "8.2s" */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** "$0.06"; sub-cent amounts keep three decimals so they don't read as free. */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(usd > 0 && usd < 0.01 ? 3 : 2)}`;
}

/** Picker hint: "~6s", or null for "no history". */
export function formatDurationHint(a: Estimated): string | null {
  return a.est_duration_ms == null ? null : `~${Math.round(a.est_duration_ms / 1000)}s`;
}

/** Card text: "8.2s · $0.06" (cost omitted when unknown), or null for "no history". */
export function formatAgentEstimate(a: Estimated): string | null {
  if (a.est_duration_ms == null) return null;
  const parts = [formatSeconds(a.est_duration_ms)];
  if (a.est_cost_usd != null) parts.push(formatCost(a.est_cost_usd));
  return parts.join(" · ");
}

/**
 * Fan-out estimate over the agents that have history: the slowest duration
 * (they run in parallel) and the null-safe sum of costs. Null when none has history.
 */
export function summariseEstimate(agents: Estimated[]): EstimateSummary | null {
  const withHistory = agents.filter(hasHistory);
  if (withHistory.length === 0) return null;
  const duration_ms = Math.max(...withHistory.map((a) => a.est_duration_ms as number));
  const costs = withHistory.map((a) => a.est_cost_usd).filter((c): c is number => c != null);
  return { duration_ms, cost_usd: costs.length ? costs.reduce((x, y) => x + y, 0) : null };
}
