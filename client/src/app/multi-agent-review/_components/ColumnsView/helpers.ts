import type { AgentColumn } from "@devdigest/shared";

/** Status → Badge colours. Badge, not Chip: Chip is always a <button> (client/INSIGHTS.md). */
export const STATUS_COLOR: Record<AgentColumn["status"], { color: string; bg: string }> = {
  running: { color: "var(--warn)", bg: "var(--warn-bg)" },
  done: { color: "var(--ok)", bg: "var(--bg-hover)" },
  failed: { color: "var(--crit)", bg: "var(--crit-bg)" },
  cancelled: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
};

/** `duration · cost` for a column header; parts that are unknown are skipped. */
export function columnMeta(
  c: Pick<AgentColumn, "duration_ms" | "cost_usd">,
  fmt: { seconds: (ms: number) => string; cost: (usd: number) => string },
): string {
  const parts: string[] = [];
  if (c.duration_ms != null) parts.push(fmt.seconds(c.duration_ms));
  if (c.cost_usd != null) parts.push(fmt.cost(c.cost_usd));
  return parts.join(" · ");
}
