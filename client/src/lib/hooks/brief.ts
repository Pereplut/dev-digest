/* hooks/brief.ts — PR Brief data hooks (spec 0018).
   GET caches the generated-or-null brief for a PR; POST (re)generates it with
   exactly one model call server-side and replaces the cache with the result. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrBriefEnvelope, PrBriefResponse } from "../types";

/**
 * The cached brief for a PR, or `{ brief: null, stale: false }` when nothing
 * has been generated yet. Never issues a POST — opening a PR page must never
 * spend a model call (AC-19/AC-34).
 */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-brief", prId],
    queryFn: () => api.get<PrBriefResponse>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}

/** Generate (or regenerate) the brief. Always an explicit click (AC-27/AC-35). */
export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrBriefEnvelope>(`/pulls/${prId}/brief`),
    onSuccess: () => {
      if (prId) qc.invalidateQueries({ queryKey: ["pr-brief", prId] });
    },
  });
}
