/**
 * Onboarding application service (spec 0017).
 *
 * The read path (`getTour`) is this commit's content; the write path
 * (`startGeneration`/`runGeneration`) lands in a later commit once the prompt
 * module exists. No drizzle, no vendor SDK here — only the repository and the
 * container's ports.
 */
import type { OnboardingReason, OnboardingTour } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { cloneRootReadable } from '../../platform/safe-read.js';
import type { IndexState } from '../repo-intel/types.js';
import { buildFacts } from './facts.js';
import { resolvePrecondition } from './helpers.js';
import { renderSections } from './render.js';
import {
  OnboardingRepository,
  toStoredTour,
  type OnboardingRepoBasics,
} from './repository/onboarding.repo.js';
import { FIRST_TASKS_LIMIT, READING_PATH_LIMIT } from './constants.js';

export interface PreconditionState {
  reason: OnboardingReason | null;
  rankedPaths: string[];
  repo: OnboardingRepoBasics;
  indexState: IndexState;
}

export class OnboardingService {
  private repo: OnboardingRepository;

  constructor(
    private container: Container,
    repo?: OnboardingRepository,
  ) {
    this.repo = repo ?? new OnboardingRepository(container.db);
  }

  // ------------------------------------------------------------------- reads

  async getTour(workspaceId: string, repoId: string): Promise<OnboardingTour> {
    const state = await this.resolveState(workspaceId, repoId);
    const row = await this.repo.getRow(repoId);
    const stored = row ? toStoredTour(row) : { sections: null, generatedAt: null };
    const currentStatus = (row?.status as OnboardingTour['status'] | undefined) ?? 'not_generated';

    // A precondition reason always outranks `generation_failed` (AC-9); only
    // when neither applies do we report the generation's own failure.
    const reason: OnboardingReason | null =
      state.reason ?? (currentStatus === 'failed' ? 'generation_failed' : null);

    let sections = stored.sections;
    let generatedAt = stored.generatedAt;
    if (sections === null) {
      // The ONE call site for the deterministic skeleton (decision 11): never
      // generated, or failed with no last good tour. A GET that already has
      // stored sections skips facts entirely (AC-59, AC-79).
      const preDegraded = state.reason === 'no_source_files' ? 'no_source_files' : null;
      const { facts, factPaths } = await this.buildFactsFor(repoId, state, preDegraded);
      sections = renderSections(facts, factPaths, null);
      generatedAt = null;
    }

    return {
      sections,
      status: currentStatus,
      reason,
      generated_at: generatedAt,
      files_indexed: state.indexState.updatedAt.getTime() > 0 ? state.indexState.filesIndexed : null,
    };
  }

  // ---------------------------------------------------------------- internal

  /**
   * One read of everything the precondition ladder and the facts builder both
   * need: the clone probe, the index state, and the single
   * `getTopFilesByRank(repoId, READING_PATH_LIMIT + 1)` call (decision 14) —
   * so AC-86's rung and AC-32/AC-33's truncation signal read the same list.
   */
  private async resolveState(workspaceId: string, repoId: string): Promise<PreconditionState> {
    const repo = await this.repo.getRepoBasics(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repository not found');

    const cloneReadable = repo.clonePath !== null && (await cloneRootReadable(repo.clonePath));
    const indexState = await this.container.repoIntel.getIndexState(repoId);
    const rankedPaths = await this.container.repoIntel.getTopFilesByRank(repoId, READING_PATH_LIMIT + 1);

    const reason = resolvePrecondition({
      flagEnabled: this.container.config.repoIntelEnabled,
      cloneReadable,
      indexState,
      rankedCount: rankedPaths.length,
    });

    return { reason, rankedPaths, repo, indexState };
  }

  private async buildFactsFor(repoId: string, state: PreconditionState, preDegradedReason: 'no_source_files' | null) {
    const [findings, candidates] = await Promise.all([
      this.repo.listOpenFindings(repoId, FIRST_TASKS_LIMIT + 1),
      this.repo.listPendingValidCandidates(repoId, FIRST_TASKS_LIMIT + 1),
    ]);
    return buildFacts({
      repoFullName: state.repo.fullName,
      repoId,
      clonePath: state.repo.clonePath,
      rankedPaths: state.rankedPaths,
      findings,
      candidates,
      preDegradedReason,
      container: this.container,
    });
  }
}
