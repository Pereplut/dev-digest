/* hooks/core.ts — typed React Query hooks over the F1 API (contracts):
   settings, secrets, repos, pulls, and project context. Scaffolding screens use
   these; feature-domain hooks live in the sibling files (agents/reviews/trace/…)
   and are re-exported alongside these from hooks/index.ts. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Settings,
  SettingsUpdate,
  ConnTestProvider,
  ConnTestResult,
  SecretsStatus,
  Repo,
  PrMeta,
  PrPage,
  PrDetail,
  SpecFile,
  IndexStatus,
  SmartDiff,
} from "../types";

// ---- Settings (F1: GET/PUT /settings, POST /settings/test-connection) ----
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Settings>("/settings"),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsUpdate) => api.put<Settings>("/settings", patch),
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
}

export function useTestConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnTestProvider | { provider: ConnTestProvider; key?: string }) => {
      const body = typeof input === "string" ? { provider: input } : input;
      return api.post<ConnTestResult>("/settings/test-connection", body);
    },
    // Saving/validating a provider key can change which models resolve — drop the
    // cached (possibly empty) model lists so the agent picker refetches, and
    // refresh the "Configured / Not set" key-status badges.
    onSuccess: (res) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: ["provider-models"] });
        qc.invalidateQueries({ queryKey: ["secrets-status"] });
      }
    },
  });
}

/** Which provider keys are configured (booleans only — never the values). */
export function useSecretsStatus() {
  return useQuery({
    queryKey: ["secrets-status"],
    queryFn: () => api.get<SecretsStatus>("/settings/secrets-status"),
    staleTime: 30_000,
  });
}

// ---- Repos (F1: GET/POST /repos, refresh, delete) ----
export function useRepos() {
  return useQuery({
    queryKey: ["repos"],
    queryFn: () => api.get<Repo[]>("/repos"),
  });
}

export function useAddRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => api.post<Repo>("/repos", { url }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });
}

export function useRefreshRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<Repo>(`/repos/${repoId}/refresh`),
    onSuccess: (_d, repoId) => {
      qc.invalidateQueries({ queryKey: ["repos"] });
      qc.invalidateQueries({ queryKey: ["pulls", repoId] });
    },
  });
}

export function useDeleteRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.del<{ deleted: string }>(`/repos/${repoId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });
}

// ---- Pull requests (F1: GET /repos/:id/pulls, GET /pulls/:id) ----
/** Page size asked of the API, and a stop so a pathological repo cannot spin. */
const PULLS_PAGE_SIZE = 200;
const PULLS_MAX_PAGES = 25;

export function usePulls(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["pulls", repoId],
    /**
     * The endpoint is keyset-paginated; this follows the cursors and hands back
     * the flat array every caller already expects — so the PR list page and the
     * shell badge are untouched.
     *
     * Deliberately NOT one page. The list derives its status filter, text
     * search, sort AND the sidebar's needs-review badge from the whole set, and
     * `status` is computed in TypeScript (needs_review / stale are derived from
     * head_sha and age, not stored), so serving one page would make the badge
     * undercount app-wide and silently apply the filters to a subset. What
     * pagination fixes is the DATABASE side: each request is now bounded, and
     * the three decoration `IN` lists span one page instead of the repo's
     * entire PR history.
     */
    queryFn: async () => {
      const out: PrMeta[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < PULLS_MAX_PAGES; page++) {
        const qs = new URLSearchParams({ limit: String(PULLS_PAGE_SIZE) });
        if (cursor) qs.set("cursor", cursor);
        const res = await api.get<PrPage>(`/repos/${repoId}/pulls?${qs.toString()}`);
        out.push(...res.items);
        cursor = res.next_cursor;
        if (!cursor) break;
      }
      return out;
    },
    enabled: !!repoId,
    // Auto-refresh PR statuses: re-sync from GitHub every 60s while the page is
    // open, and whenever the window regains focus.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function usePullDetail(prId: string | number | null | undefined) {
  return useQuery({
    queryKey: ["pull", prId],
    queryFn: () => api.get<PrDetail>(`/pulls/${prId}`),
    enabled: prId != null,
  });
}

/**
 * PR detail addressed the way the route is keyed: repo + PR number.
 *
 * The detail page used to call `usePulls` purely to translate the number in
 * the URL into a row uuid, which meant waiting for the entire PR list — an
 * endpoint that also syncs from GitHub and backfills diff stats — before the
 * detail request could even start.
 */
export function usePullByNumber(
  repoId: string | null | undefined,
  number: string | number | null | undefined,
) {
  return useQuery({
    queryKey: ["pull-by-number", repoId, number],
    queryFn: () => api.get<PrDetail>(`/repos/${repoId}/pulls/${number}`),
    enabled: !!repoId && number != null,
  });
}

/**
 * Smart Diff: the PR's files grouped by role, for the Files changed tab.
 *
 * `enabled: !!prId` is load-bearing beyond the usual guard — `prId` only exists
 * once the PR-detail query resolved, and that request is what persists `pr_files`
 * server-side. Waiting for it is what keeps this from racing an empty table.
 *
 * Costs nothing to call before a review: grouping is pure path classification and
 * the route makes no model call.
 */
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart-diff", prId],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
  });
}

// ---- Project Context (A3 contract; safe to call once API exposes it) ----
export function useContextFiles(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context", repoId],
    queryFn: () => api.get<SpecFile[]>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

export function useReindexContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<IndexStatus>(`/repos/${repoId}/context/reindex`),
    onSuccess: (_d, repoId) => qc.invalidateQueries({ queryKey: ["context", repoId] }),
  });
}
