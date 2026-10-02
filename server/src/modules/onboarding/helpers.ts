/**
 * Pure onboarding domain helpers — no drizzle, no IO, no container. The
 * precondition resolver is the service's read AND write path's single source
 * of truth for "can this repo be generated/served right now, and why not".
 */
import type { OnboardingReason, OnboardingSectionKind } from '@devdigest/shared';
import type { IndexState } from '../repo-intel/types.js';

export interface PreconditionInput {
  /** `config.repoIntelEnabled` (AC-6). */
  flagEnabled: boolean;
  /** `clone_path` is non-null AND the clone root is lstat-able (AC-5). */
  cloneReadable: boolean;
  /** `repoIntel.getIndexState`'s row, or `null` when none exists (AC-7). */
  indexState: IndexState | null;
  /**
   * `repoIntel.getTopFilesByRank(repoId, READING_PATH_LIMIT + 1)`'s length.
   * The behavioural last rung (AC-86): zero ranked paths means no fact path
   * set survives for the tour to ground against, whatever the index row's own
   * `status`/`stats.reason` say — a graph failure persists `partial` with
   * `filesIndexed > 0`, not `degraded`/`failed` with `reason: 'no_files'`.
   */
  rankedCount: number;
}

/**
 * The precondition ladder, in the precedence AC-9 fixes: `flag_off` →
 * `no_clone` → `not_indexed` → `no_source_files` → `index_incomplete` → null
 * (healthy). `null` means neither GET nor POST is blocked by a precondition;
 * GET may still report `generation_failed` separately (the caller's job, since
 * that reason needs the onboarding row, not just repo-intel state).
 */
export function resolvePrecondition(input: PreconditionInput): OnboardingReason | null {
  if (!input.flagEnabled) return 'flag_off';
  if (!input.cloneReadable) return 'no_clone';

  const state = input.indexState;
  if (!state || state.status === 'degraded' || state.status === 'failed') return 'not_indexed';
  if (state.filesIndexed === 0 && state.reason === 'no_files') return 'no_source_files';
  if (input.rankedCount === 0) return 'index_incomplete';
  return null;
}

/**
 * Under `no_source_files`, these two sections are pre-degraded BEFORE the
 * prompt is assembled and are never offered to the model (ANSWERED 1): the
 * fact path set in that state is at most the seven allowlisted root files, so
 * asking the model for a reading order or a dependency chain it cannot ground
 * would be exactly the "ungrounded model call" the spec forbids.
 */
export const NO_SOURCE_FILES_DEGRADED_KINDS: readonly OnboardingSectionKind[] = [
  'critical_paths',
  'reading_path',
];
