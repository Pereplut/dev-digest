/* hooks/onboarding.ts — React Query hooks for the per-repository onboarding
   tour (spec 0017):
     GET  /repos/:id/onboarding  → OnboardingTour (always 5 sections, AC-3)
     POST /repos/:id/onboarding  → OnboardingStart (202, job_id nullable)

   The poll is BOUNDED (AC-52, AC-87): `refetchInterval` here is a function,
   not the bare constant `hooks/repo-intel.ts` uses, because that constant
   form can never stop. Decision 16 (spec 0017 plan): the attempt count lives
   in a ref (it must survive across refetches without itself triggering a
   render) and `gaveUp` is state (it must trigger one, so the page can
   re-enable Regenerate and show the reload sentence). Both reset whenever a
   fetch reports a status other than "running", and reset() does it on demand
   for a freshly issued Regenerate. */
"use client";

import React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { OnboardingStart, OnboardingTour } from "../types";

/** Poll cadence while `status: 'running'` (AC-52) and the attempt ceiling
    past which the page stops polling and gives up (AC-87). 40 * 3s = 120s,
    longer than the server's GENERATION_TIMEOUT_MS, so a generation that
    fails on its own timeout is still observed before the page gives up.
    Canonical here (the hook is what counts attempts); the OnboardingTour
    component re-exports these from its own constants.ts for display/tests. */
export const TOUR_POLL_INTERVAL_MS = 3_000;
export const TOUR_POLL_MAX_ATTEMPTS = 40;

/** GET /repos/:id/onboarding, polling at most TOUR_POLL_MAX_ATTEMPTS times
    while `status: 'running'`, then stopping and reporting `gaveUp`. */
export function useOnboardingTour(repoId: string | null | undefined) {
  const attempts = React.useRef(0);
  // TanStack calls `refetchInterval` more than once per actual refetch (once
  // per state transition it recomputes against — fetching, then success), so
  // counting on every CALL over-counts. `dataUpdatedAt` only advances once a
  // fetch genuinely completes, so comparing against the last seen value is
  // what makes one real poll count as exactly one attempt.
  const lastUpdatedAt = React.useRef(0);
  const [gaveUp, setGaveUp] = React.useState(false);

  const query = useQuery({
    queryKey: ["onboarding-tour", repoId],
    queryFn: () => api.get<OnboardingTour>(`/repos/${repoId}/onboarding`),
    enabled: !!repoId,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status !== "running") {
        attempts.current = 0;
        lastUpdatedAt.current = q.state.dataUpdatedAt;
        return false;
      }
      if (q.state.dataUpdatedAt !== lastUpdatedAt.current) {
        lastUpdatedAt.current = q.state.dataUpdatedAt;
        attempts.current += 1;
      }
      if (attempts.current > TOUR_POLL_MAX_ATTEMPTS) {
        setGaveUp(true);
        return false;
      }
      return TOUR_POLL_INTERVAL_MS;
    },
  });

  const resetPolling = React.useCallback(() => {
    attempts.current = 0;
    setGaveUp(false);
  }, []);

  return { ...query, gaveUp, resetPolling };
}

/** POST /repos/:id/onboarding — issues a new generation. No confirmation
    dialog (AC-73): the caller fires this straight from the click handler. */
export function useRegenerateOnboarding(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<OnboardingStart>(`/repos/${repoId}/onboarding`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["onboarding-tour", repoId] });
    },
  });
}
