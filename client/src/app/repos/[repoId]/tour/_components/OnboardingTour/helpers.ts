/* Pure selectors + formatters for the onboarding tour page. No React, no
   i18n strings — the component looks up the i18n key the `unit` names. */
import type { OnboardingReason, OnboardingSection } from "@/lib/types";
import { BLOCKING_REASONS, REINDEXABLE_REASONS } from "./constants";

export type AgeUnit = "justNow" | "minutes" | "hours" | "days";

/** Age of `generatedAt`, bucketed for the `tour.age.*` i18n keys. A clock-skew
    `generatedAt` that is AFTER `now` (server ahead of the client, or a clock
    jump) clamps to "just now" rather than a negative or "in 2 hours" value. */
export function computeAge(generatedAt: string, now: number = Date.now()): { unit: AgeUnit; count: number } {
  const then = Date.parse(generatedAt);
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return { unit: "justNow", count: 0 };
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return { unit: "minutes", count: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { unit: "hours", count: hours };
  return { unit: "days", count: Math.round(hours / 24) };
}

/** AC-78: the heading shows only the segment of `full_name` after `/`. */
export function repoShortName(fullName: string): string {
  const i = fullName.lastIndexOf("/");
  return i === -1 ? fullName : fullName.slice(i + 1);
}

/** Sum of `dropped_refs` across all five sections (AC-54). */
export function droppedTotal(sections: OnboardingSection[]): number {
  return sections.reduce((n, s) => n + s.dropped_refs, 0);
}

/** AC-53: Regenerate is disabled under any of the four blocking reasons
    (`flag_off`, `no_clone`, `not_indexed`, `index_incomplete`) — `running`
    disables it too, but that is a separate check on `status`. */
export function isBlockingReason(reason: OnboardingReason | null): boolean {
  return reason != null && BLOCKING_REASONS.includes(reason);
}

/** AC-63, AC-64: Re-index renders only under `not_indexed` / `index_incomplete`. */
export function isReindexableReason(reason: OnboardingReason | null): boolean {
  return reason != null && REINDEXABLE_REASONS.includes(reason);
}

/** AC-50: whether the `role="status"` element renders at all — anything but
    `done`, or (ANSWERED 2) a `done` tour that still dropped references. */
export function showsStatus(status: string, dropped: number): boolean {
  return status !== "done" || dropped > 0;
}
