/* hooks/ci.ts — React Query hooks for Export to CI (spec 0022):
     POST /agents/:id/export-ci          → CiExport
     GET  /agents/:id/ci/installations   → CiInstallation[]
     POST /agents/:id/ci/update          → CiUpdateResult
     POST /ci/refresh                    → CiRefreshResult
     GET  /ci/runs[?agent_id=]           → CiRun[]
   Types only from @devdigest/shared (a value import breaks next dev/build). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  CiExport,
  CiExportInputBody,
  CiInstallation,
  CiRefreshResult,
  CiRun,
  CiUpdateResult,
} from "@devdigest/shared";

export const CI_RUNS_QUERY_KEY = ["ci-runs"] as const;
const installationsKey = (agentId: string | null | undefined) => ["ci-installations", agentId] as const;

/** POST /agents/:id/export-ci. `action: "files"` returns the file set with no
 *  GitHub write (Preview step, zip); `action: "open_pr"` opens the PR. */
export function useExportCi(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CiExportInputBody) =>
      api.post<CiExport>(`/agents/${agentId}/export-ci`, input),
    onSuccess: (data) => {
      // Only a persisted installation (the open_pr path) changes the lists; a
      // files-only call returns `installation: null` and must not refetch.
      if (data.installation) {
        qc.invalidateQueries({ queryKey: installationsKey(agentId) });
      }
    },
  });
}

/** GET /agents/:id/ci/installations — one row per repository. */
export function useCiInstallations(agentId: string | null | undefined) {
  return useQuery({
    queryKey: installationsKey(agentId),
    queryFn: () => api.get<CiInstallation[]>(`/agents/${agentId}/ci/installations`),
    enabled: !!agentId,
  });
}

/** POST /agents/:id/ci/update — re-export every installation from stored settings. */
export function useUpdateCi(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CiUpdateResult>(`/agents/${agentId}/ci/update`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: installationsKey(agentId) });
    },
  });
}

/** GET /ci/runs, optionally narrowed to one agent (`?agent_id=`). */
export function useCiRuns(agentId?: string | null) {
  return useQuery({
    queryKey: [...CI_RUNS_QUERY_KEY, agentId ?? null],
    queryFn: () =>
      api.get<CiRun[]>(agentId ? `/ci/runs?agent_id=${encodeURIComponent(agentId)}` : "/ci/runs"),
  });
}

/** POST /ci/refresh — pull-ingest completed runs, then refetch the lists. A
 *  degraded result changes no rows, so the refetch keeps what is on screen. */
export function useRefreshCi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CiRefreshResult>("/ci/refresh"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CI_RUNS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["ci-installations"] });
    },
  });
}
