import type { Container } from '../../platform/container.js';
import type { EvalCaseFromFindingInput, EvalCasePatch } from '@devdigest/shared';
import type { AgentRow, EvalCaseRow, EvalRunBatchRow, EvalRunRow } from '../../db/rows.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
// Case creation needs the finding's pull request's diff — the ONE place
// `modules/evals/` may import `reviews/diff-loader.ts` (AC-37); the background
// executor (`run-executor.ts`) imports neither it nor `reviews/run-executor.ts`.
import { loadDiff } from '../reviews/diff-loader.js';
import { EVAL_REAP_ERROR } from './constants.js';
import { EvalBatchRepository } from './repository/eval-batch.repo.js';
import { EvalCaseRepository } from './repository/eval-case.repo.js';
import { EvalRunExecutor, type Logger } from './run-executor.js';

/**
 * EvalService (spec 0019): turns an accepted/dismissed finding into an eval
 * case, queues a batch sweep of an agent's cases through the real engine, and
 * reads back cases/batches. Repositories are constructed from `container.db`
 * (matching `OnboardingRepository` at `app.ts:112`) rather than via a new
 * container getter.
 */
export class EvalService {
  private caseRepo: EvalCaseRepository;
  private batchRepo: EvalBatchRepository;
  private executor: EvalRunExecutor;

  constructor(private container: Container) {
    this.caseRepo = new EvalCaseRepository(container.db);
    this.batchRepo = new EvalBatchRepository(container.db);
    this.executor = new EvalRunExecutor(container, this.batchRepo);
  }

  // ===========================================================================
  // Case creation
  // ===========================================================================

  async createCaseFromFinding(
    workspaceId: string,
    input: EvalCaseFromFindingInput,
  ): Promise<EvalCaseRow> {
    const ctx = await this.container.reviewRepo.findingContext(input.finding_id);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) {
      throw new NotFoundError('Finding not found');
    }
    const { finding, review, pull } = ctx;
    if (!review.agentId) {
      throw new ValidationError('This finding has no owning agent');
    }

    // AC-23: derived from accept/dismiss — accepted wins if a finding somehow
    // carries both (not reachable through the findings API today).
    let expectationKind: 'must_find' | 'must_not_flag';
    if (finding.acceptedAt) expectationKind = 'must_find';
    else if (finding.dismissedAt) expectationKind = 'must_not_flag';
    else {
      // AC-25
      throw new ValidationError('Accept or dismiss this finding before turning it into an eval case');
    }

    const repoRow = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    // AC-24/AC-26: snapshot the PR's diff now; never re-fetched at run time.
    // `loadDiff` already falls back to `pr_files` before giving up, so an
    // empty result here means both paths failed.
    const diff = await loadDiff(this.container, this.container.reviewRepo, workspaceId, pull, repoRow);
    if (diff.files.length === 0) {
      throw new ValidationError("Could not load this pull request's diff: no changed files available");
    }

    // AC-22/AC-66: owner = the finding's review's agent; target = the finding's
    // own file + range; AC-67: a duplicate (owner_id, source_finding_id) is a
    // ConflictError raised by the repository (the unique index, AC-64).
    return this.caseRepo.insertFromFinding({
      workspaceId,
      ownerKind: 'agent',
      ownerId: review.agentId,
      name: input.name?.trim() || finding.title,
      inputDiff: diff.raw,
      notes: input.notes ?? null,
      expectationKind,
      expectedFile: finding.file,
      expectedStartLine: finding.startLine,
      expectedEndLine: finding.endLine,
      sourceFindingId: finding.id,
    });
  }

  // ===========================================================================
  // Case read / edit / delete
  // ===========================================================================

  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseRow[]> {
    await this.requireAgent(workspaceId, agentId);
    return this.caseRepo.listForAgent(workspaceId, agentId);
  }

  async patchCase(workspaceId: string, id: string, patch: EvalCasePatch): Promise<EvalCaseRow> {
    const existing = await this.caseRepo.getScoped(workspaceId, id);
    if (!existing) throw new NotFoundError('Eval case not found');
    const row = await this.caseRepo.patch(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.expectation_kind !== undefined ? { expectationKind: patch.expectation_kind } : {}),
      ...(patch.expected_file !== undefined ? { expectedFile: patch.expected_file } : {}),
      ...(patch.expected_start_line !== undefined ? { expectedStartLine: patch.expected_start_line } : {}),
      ...(patch.expected_end_line !== undefined ? { expectedEndLine: patch.expected_end_line } : {}),
    });
    if (!row) throw new NotFoundError('Eval case not found');
    return row;
  }

  async deleteCase(workspaceId: string, id: string): Promise<void> {
    const existing = await this.caseRepo.getScoped(workspaceId, id);
    if (!existing) throw new NotFoundError('Eval case not found');
    await this.caseRepo.remove(workspaceId, id);
  }

  // ===========================================================================
  // Batch run
  // ===========================================================================

  async queueBatch(workspaceId: string, agentId: string, logger?: Logger): Promise<{ batchId: string }> {
    const agent = await this.requireAgent(workspaceId, agentId);

    // AC-33: zero cases → 422, no batch.
    const cases = await this.caseRepo.listForAgent(workspaceId, agentId);
    if (cases.length === 0) {
      throw new ValidationError('This agent has no eval cases to run');
    }
    // AC-34: a live batch already exists → 409. The database's partial unique
    // index (AC-76) is the backstop for the race this read-then-write leaves open.
    if (await this.batchRepo.hasLiveBatch(agentId)) {
      throw new ConflictError('An eval run is already queued or running for this agent');
    }

    // AC-38: copy the agent row's id + version onto the batch.
    const batch = await this.batchRepo.insertQueued({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      agentId: agent.id,
      agentVersion: agent.version,
      casesTotal: cases.length,
    });

    // Fire-and-forget: the route returns 202 with batch_id now; the sweep
    // progresses in the background and streams over container.runBus.
    void this.executor.run({ batchId: batch.id, workspaceId, agent, cases }, logger).catch((err) => {
      logger?.error(
        { batchId: batch.id, err: (err as Error).message },
        'evals: background execution crashed',
      );
    });

    return { batchId: batch.id };
  }

  async listBatches(workspaceId: string, agentId: string): Promise<EvalRunBatchRow[]> {
    await this.requireAgent(workspaceId, agentId);
    return this.batchRepo.listForAgent(workspaceId, agentId);
  }

  async getBatch(
    workspaceId: string,
    batchId: string,
  ): Promise<{ batch: EvalRunBatchRow; runs: (EvalRunRow & { caseName: string | null })[] }> {
    const result = await this.batchRepo.getWithRuns(workspaceId, batchId);
    if (!result) throw new NotFoundError('Eval run not found');
    return result;
  }

  async cancelBatch(workspaceId: string, batchId: string): Promise<void> {
    const batch = await this.batchRepo.getScoped(workspaceId, batchId);
    if (!batch) throw new NotFoundError('Eval run not found');
    // AC-70: a terminal batch → 409, no row changed.
    if (batch.status !== 'queued' && batch.status !== 'running') {
      throw new ConflictError('This eval run has already finished');
    }
    // AC-69: the executor (running in-process) notices at its next
    // per-case checkpoint and writes the terminal `cancelled` row itself
    // (AC-71) — this call only signals it, mirroring `registerAbort`'s
    // contract: a no-op if nothing is currently in flight.
    this.container.runBus.cancel(batchId);
  }

  // ===========================================================================
  // Boot reap
  // ===========================================================================

  /** Every `queued`/`running` batch is orphaned by a restart (AC-72). */
  async reapOrphanedBatches(): Promise<number> {
    return this.batchRepo.failOrphaned(EVAL_REAP_ERROR);
  }

  private async requireAgent(workspaceId: string, agentId: string): Promise<AgentRow> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }
}
