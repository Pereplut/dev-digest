/**
 * Onboarding application service (spec 0017). No drizzle, no vendor SDK here
 * — only the repository and the container's ports.
 */
import { randomUUID } from 'node:crypto';
import type { OnboardingReason, OnboardingTour } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConflictError, NotFoundError } from '../../platform/errors.js';
import { cloneRootReadable } from '../../platform/safe-read.js';
import { withTimeout } from '../../platform/resilience.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import type { IndexState } from '../repo-intel/types.js';
import { buildFacts } from './facts.js';
import { Draft, ONBOARDING_DRAFT_SCHEMA_NAME } from './draft.js';
import { resolvePrecondition } from './helpers.js';
import { buildOnboardingMessages } from './prompt.js';
import { deriveOnboardingStatus, renderSections } from './render.js';
import {
  OnboardingRepository,
  toStoredTour,
  type OnboardingRepoBasics,
} from './repository/onboarding.repo.js';
import {
  FIRST_TASKS_LIMIT,
  GENERATION_TIMEOUT_MS,
  ONBOARDING_JOB_KIND,
  READING_PATH_LIMIT,
} from './constants.js';

/** The four precondition reasons that refuse a POST outright (AC-10). */
const BLOCKING_REASONS: readonly OnboardingReason[] = [
  'flag_off',
  'no_clone',
  'not_indexed',
  'index_incomplete',
];

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

  // ------------------------------------------------------------------ writes

  /**
   * Claim first, enqueue second, stamp the job id third (plan decision 2).
   * The claim statement alone decides AC-20 (stale takeover) and AC-21
   * (exactly one winner) — order here only matters for AC-19's loser window.
   */
  async startGeneration(workspaceId: string, repoId: string): Promise<{ jobId: string | null }> {
    const state = await this.resolveState(workspaceId, repoId);
    if (state.reason !== null && (BLOCKING_REASONS as readonly string[]).includes(state.reason)) {
      // AC-10: flag_off / no_clone / not_indexed / index_incomplete — no job,
      // no model call.
      throw new ConflictError('The onboarding tour cannot be generated right now', {
        reason: state.reason,
      });
    }

    const generationId = randomUUID();
    const claimed = await this.repo.claimGeneration(repoId, generationId);
    if (!claimed) {
      // AC-19: a fresh `running` generation already holds the row. The
      // winner always stamps job_id before responding (step below), so the
      // only null here is the sub-millisecond window before that stamp.
      const existing = await this.repo.getRow(repoId);
      return { jobId: existing?.jobId ?? null };
    }

    try {
      const job = await this.container.jobs.enqueue(workspaceId, ONBOARDING_JOB_KIND, {
        workspaceId,
        repoId,
        generationId,
      });
      // Nobody else awaits `done`; without a sink an ultimately-failed job is
      // an unhandled rejection (server/INSIGHTS.md, 2026-09-18).
      void job.done.catch(() => undefined);
      await this.repo.setJobId(repoId, generationId, job.id);
      return { jobId: job.id };
    } catch {
      await this.repo.markFailed(repoId, generationId);
      return { jobId: null };
    }
  }

  /**
   * The job handler body. Decision 3: the FIRST act is an identity re-read —
   * `withRetry` wraps `withTimeout(handler)` AND the bookkeeping write
   * (`platform/jobs.ts`), so a retried invocation after a successful
   * generation must no-op here, not call the model a second time (AC-13).
   */
  async runGeneration(workspaceId: string, repoId: string, generationId: string): Promise<void> {
    const current = await this.repo.getRow(repoId);
    if (!current || current.generationId !== generationId || current.status !== 'running') return;

    const body = async (): Promise<void> => {
      const state = await this.resolveState(workspaceId, repoId);
      const preDegraded = state.reason === 'no_source_files' ? 'no_source_files' : null;
      const { facts, factPaths } = await this.buildFactsFor(repoId, state, preDegraded);
      const messages = await buildOnboardingMessages(facts);

      const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'onboarding');
      const llm = await this.container.llm(provider);

      let draft: Draft;
      try {
        const result = await llm.completeStructured({
          model,
          schema: Draft,
          schemaName: ONBOARDING_DRAFT_SCHEMA_NAME,
          messages,
          temperature: 0,
        });
        draft = result.data;
      } catch (err) {
        // AC-13: rethrow a PLAIN Error — stripped of any `.status`/`.code` the
        // provider error carried — so `withRetry` (outside this call, in
        // `JobRunner`) cannot retry a 429/503 into a second model call.
        throw new Error(err instanceof Error ? err.message : 'completeStructured failed');
      }

      const sections = renderSections(facts, factPaths, draft);
      const status = deriveOnboardingStatus(sections);
      await this.repo.saveTour(repoId, generationId, sections, status);
    };

    try {
      // AC-16: races the WHOLE body — facts, every clone read, the model
      // call, the render step and the write — not just `completeStructured`.
      await withTimeout(body(), GENERATION_TIMEOUT_MS);
    } catch {
      // AC-15/AC-17: persisted OUTSIDE the race, guarded by generation_id +
      // status='running' (invariant I3) — a write from a generation some
      // later claim already superseded affects zero rows, never a stored
      // tour (AC-58's byte-identity holds by construction).
      await this.repo.markFailed(repoId, generationId);
      throw new Error('Onboarding generation failed');
    }
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
