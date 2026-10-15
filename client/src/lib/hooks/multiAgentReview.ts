/* hooks/multiAgentReview.ts — React Query hooks for the multi-agent review (spec 0021).
   Types only from @devdigest/shared (a value import breaks `next build`). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { MultiAgentLatest, MultiAgentRun } from "@devdigest/shared";

/** Refetch cadence (ms) while a column is still running (AC-37). */
export const POLL_MS = 3000;

/** True while any column has not reached a terminal status. Pure — see client/INSIGHTS.md (refetchInterval). */
export function anyColumnRunning(run: MultiAgentRun | undefined): boolean {
  return !!run && run.columns.some((c) => c.status === "running");
}

/** One fan-out: columns + conflict groups. Polls every 3 s while a column runs. */
export function useMultiAgentRun(id: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-run", id],
    queryFn: () => api.get<MultiAgentRun>(`/multi-agent/${id}`),
    enabled: !!id,
    refetchInterval: (query) => (anyColumnRunning(query.state.data) ? POLL_MS : false),
  });
}

/**
 * The newest multi-agent run — for one PR when `prId` is a string, the
 * workspace's when it is omitted (`undefined`). `null` means "PR not known yet"
 * and disables the query, so a PR page never falls back to the workspace-wide run.
 * `data.run` is null when none exists; a falsy `data` while the query loads
 * means "unknown", not "none" (destructure `isLoading`).
 */
export function useLatestMultiAgentRun(prId?: string | null) {
  return useQuery({
    queryKey: ["multi-agent-latest", prId ?? null],
    queryFn: () =>
      api.get<MultiAgentLatest>(
        prId ? `/multi-agent/latest?pr_id=${encodeURIComponent(prId)}` : "/multi-agent/latest",
      ),
    enabled: prId !== null,
  });
}
