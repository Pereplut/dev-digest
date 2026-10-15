import type { AgentColumn } from "@devdigest/shared";

/** Run ids still in flight — the only ones worth an SSE subscription (AC-37). */
export function runningRunIds(columns: AgentColumn[]): string[] {
  return columns.filter((c) => c.status === "running").map((c) => c.run_id);
}

/** `/multi-agent-review?new=1&pr=<prId>` — Configure run with this PR preselected. */
export function configureHref(prId: string): string {
  return `/multi-agent-review?new=1&pr=${encodeURIComponent(prId)}`;
}
