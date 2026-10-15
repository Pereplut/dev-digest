import type { AgentColumn } from "@devdigest/shared";

/**
 * `duration · cost` for an agent's header; parts that are unknown are skipped.
 * Feature-level because both ColumnsView and TabsView render it (promote on the second consumer).
 */
export function columnMeta(
  c: Pick<AgentColumn, "duration_ms" | "cost_usd">,
  fmt: { seconds: (ms: number) => string; cost: (usd: number) => string },
): string {
  const parts: string[] = [];
  if (c.duration_ms != null) parts.push(fmt.seconds(c.duration_ms));
  if (c.cost_usd != null) parts.push(fmt.cost(c.cost_usd));
  return parts.join(" · ");
}
