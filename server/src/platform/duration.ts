import prettyMs from 'pretty-ms';

/**
 * Human-readable run durations for logs and the run trace (pure — no DB, no
 * `this`, so it unit-tests cleanly).
 *
 * `agent_runs.duration_ms` is nullable: a run that failed before it started, or
 * one still in flight, has no duration, and the UI shows an em dash for those
 * rather than "0ms". Keeping that decision in one function stops each call site
 * inventing its own placeholder.
 */

/** Shown when a run has no measured duration. */
export const NO_DURATION = '—';

/**
 * Format a duration in milliseconds. Returns {@link NO_DURATION} for null,
 * undefined, a non-finite number, or a negative one — all of which mean "not
 * measured" rather than "took no time".
 */
export function formatRunDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return NO_DURATION;
  return prettyMs(ms);
}
