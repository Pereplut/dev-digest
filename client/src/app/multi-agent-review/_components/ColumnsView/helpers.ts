import type { AgentColumn } from "@devdigest/shared";

/** Status → Badge colours. Badge, not Chip: Chip is always a <button> (client/INSIGHTS.md). */
export const STATUS_COLOR: Record<AgentColumn["status"], { color: string; bg: string }> = {
  running: { color: "var(--warn)", bg: "var(--warn-bg)" },
  done: { color: "var(--ok)", bg: "var(--bg-hover)" },
  failed: { color: "var(--crit)", bg: "var(--crit-bg)" },
  cancelled: { color: "var(--text-secondary)", bg: "var(--bg-hover)" },
};
