/* Constants for the onboarding tour page (spec 0017).

   Only `import type` from "@devdigest/shared" is allowed in the client — a
   value import passes typecheck and vitest but breaks `next build`
   (client/INSIGHTS.md 2026-09-19). So the five section kinds and the six
   reasons are mirrored here as local literals rather than read off the
   vendored Zod enums. */
import type { OnboardingReason, OnboardingSectionKind } from "@/lib/types";

export { TOUR_POLL_INTERVAL_MS, TOUR_POLL_MAX_ATTEMPTS } from "@/lib/hooks/onboarding";

/** The five fixed section kinds, in fixed display order (AC-1, AC-3). */
export const SECTION_KINDS: OnboardingSectionKind[] = [
  "architecture",
  "critical_paths",
  "run_locally",
  "reading_path",
  "first_tasks",
];

/** The six reasons a tour (or a POST) can be blocked or degraded (AC-2). */
export const BLOCKING_REASONS: OnboardingReason[] = [
  "flag_off",
  "no_clone",
  "not_indexed",
  "index_incomplete",
];

/** Reasons under which the Re-index control renders (AC-63); `no_source_files`
    is deliberately excluded (AC-64) — a repo with no supported files yields
    zero files again on a re-index, a loop with no exit. */
export const REINDEXABLE_REASONS: OnboardingReason[] = ["not_indexed", "index_incomplete"];
