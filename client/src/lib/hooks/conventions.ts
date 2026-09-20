/* hooks/conventions.ts — React Query hooks for the Conventions Extractor (spec 0007).

     GET   /repos/:id/conventions         → candidates + the latest scan
     POST  /repos/:id/conventions/extract → 202, the scan then runs in the background
     GET   /repos/:id/conventions/skill   → server-computed skill defaults
     POST  /repos/:id/conventions/skill   → create the skill from the edited draft
     PATCH /conventions/:id               → accept / reject / edit one candidate

   Extraction is asynchronous, so `useConventions` polls while a scan is running —
   the same shape as hooks/repo-intel.ts. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ConventionCandidate,
  ConventionPatch,
  ConventionSkillDefaults,
  ConventionSkillDraft,
  ConventionsPage,
  Skill,
} from "@devdigest/shared";
import { api } from "../api";

export const conventionsKey = (repoId: string | null | undefined) =>
  ["conventions", repoId] as const;

export const conventionSkillDefaultsKey = (repoId: string | null | undefined) =>
  ["convention-skill-defaults", repoId] as const;

/**
 * Candidates + the latest scan. While `poll` is true the query refetches, so a
 * running extraction's result appears without the user reloading. The caller
 * decides when to poll (scan.status === "running"), which keeps the stop
 * condition next to the data that carries it.
 */
export function useConventions(repoId: string | null | undefined, poll = false) {
  return useQuery({
    queryKey: conventionsKey(repoId),
    queryFn: () => api.get<ConventionsPage>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
    refetchInterval: poll ? 1500 : false,
  });
}

/** Kick off a scan. Resolves as soon as the server has queued it (202). */
export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ status: string }>(`/repos/${repoId}/conventions/extract`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: conventionsKey(repoId) });
    },
  });
}

/**
 * Accept, reject or edit one candidate, applied optimistically so the card
 * responds immediately; the cache is rolled back if the request fails. The
 * global MutationCache already surfaces the error as a toast.
 */
export function usePatchConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ConventionPatch }) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onMutate: async ({ id, patch }) => {
      const key = conventionsKey(repoId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ConventionsPage>(key);
      if (previous) {
        qc.setQueryData<ConventionsPage>(key, {
          ...previous,
          candidates: previous.candidates.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(conventionsKey(repoId), ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: conventionSkillDefaultsKey(repoId) });
    },
  });
}

/**
 * Apply one patch to MANY candidates as a single mutation.
 *
 * Firing N separate `usePatchConvention` calls from one click races: each
 * snapshots the cache in its own `onMutate`, so if any one request fails its
 * rollback restores a snapshot taken before the siblings' updates and silently
 * reverts them too. One mutation means one snapshot, one rollback, and one
 * invalidation that re-syncs the list with the server either way.
 */
export function useBulkPatchConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, patch }: { ids: string[]; patch: ConventionPatch }) =>
      Promise.all(ids.map((id) => api.patch<ConventionCandidate>(`/conventions/${id}`, patch))),
    onMutate: async ({ ids, patch }) => {
      const key = conventionsKey(repoId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ConventionsPage>(key);
      if (previous) {
        const targets = new Set(ids);
        qc.setQueryData<ConventionsPage>(key, {
          ...previous,
          candidates: previous.candidates.map((c) =>
            targets.has(c.id) ? { ...c, ...patch } : c,
          ),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(conventionsKey(repoId), ctx.previous);
    },
    onSettled: () => {
      // A partial failure leaves the cache guessing, so re-read the truth.
      qc.invalidateQueries({ queryKey: conventionsKey(repoId) });
      qc.invalidateQueries({ queryKey: conventionSkillDefaultsKey(repoId) });
    },
  });
}

/** The prefilled name/description/body the create-skill modal opens with. */
export function useConventionSkillDefaults(repoId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: conventionSkillDefaultsKey(repoId),
    queryFn: () => api.get<ConventionSkillDefaults>(`/repos/${repoId}/conventions/skill`),
    enabled: !!repoId && enabled,
  });
}

/** Save the skill the user edited in the modal. */
export function useCreateConventionSkill(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: ConventionSkillDraft) =>
      api.post<Skill>(`/repos/${repoId}/conventions/skill`, draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
