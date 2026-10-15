/* hooks/evals.ts — React Query hooks for the agent eval harness (spec 0019).
   Progress on a live batch reuses `useRunEvents` (hooks/reviews.ts) over the
   existing `/runs/:id/events` SSE route — a batch id streams through it
   unchanged, so no second hook family is needed here. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalBatchDetail,
  EvalBatchRecord,
  EvalCase,
  EvalCaseFromFindingInput,
  EvalDashboard,
  EvalRunComparison,
} from "@devdigest/shared";

/** Every eval case owned by this agent, server-ordered `created_at DESC`. */
export function useAgentEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-eval-cases", agentId],
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

/**
 * This agent's eval batches. The server returns them newest-first; the caller
 * reads the latest from element 0 and must never re-sort this list — there is
 * no `latest_batch` field anywhere, by design (AC-74).
 */
export function useAgentEvalBatches(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-eval-batches", agentId],
    queryFn: () => api.get<EvalBatchRecord[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
  });
}

/** One batch + one entry per case run (`GET /eval-runs/:batchId`). */
export function useEvalBatch(batchId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-batch", batchId],
    queryFn: () => api.get<EvalBatchDetail>(`/eval-runs/${batchId}`),
    enabled: !!batchId,
  });
}

/**
 * Turn one finding into an eval case — the `FindingCard` control (AC-48–52).
 * Invalidates the owning agent's case list, keyed from the created case's own
 * `owner_id` rather than a prop, because `FindingCard` never learns the
 * agent id otherwise.
 */
export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseFromFindingInput) => api.post<EvalCase>("/eval-cases", input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["agent-eval-cases", data.owner_id] });
    },
  });
}

/** The per-agent eval dashboard — tiles, trend, recent runs (spec 0020, AC-11). */
export function useAgentEvalDashboard(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-eval-dashboard", agentId],
    queryFn: () => api.get<EvalDashboard>(`/agents/${agentId}/eval-dashboard`),
    enabled: !!agentId,
  });
}

/**
 * Compare two batches of the same agent. `enabled: !!pair` so this fires only
 * when the Compare control is activated (strictly on demand, spec 0020
 * `## Non-functional`), never on every render of the recent-runs table.
 */
export function useEvalCompare(agentId: string | null | undefined, pair: [string, string] | null) {
  return useQuery({
    queryKey: ["eval-compare", agentId, pair?.[0], pair?.[1]],
    queryFn: () =>
      api.get<EvalRunComparison>(`/agents/${agentId}/eval-runs/compare?a=${pair![0]}&b=${pair![1]}`),
    enabled: !!agentId && !!pair,
  });
}

/** Queue a batch run of every one of this agent's eval cases. */
export function useRunEvals(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ batch_id: string }>(`/agents/${agentId}/eval-runs`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-eval-batches", agentId] });
    },
  });
}
