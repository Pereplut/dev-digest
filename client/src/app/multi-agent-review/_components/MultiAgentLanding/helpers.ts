import type { MultiAgentLatest } from "@devdigest/shared";

/**
 * The run id to redirect to, or null to show Configure run (AC-29).
 * `?new=1` always wins; a missing response (loading/error) is not a run.
 */
export function landingTarget(isNew: boolean, latest: MultiAgentLatest | undefined): string | null {
  if (isNew) return null;
  return latest?.run?.id ?? null;
}
