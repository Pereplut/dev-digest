import type { Container } from '../../platform/container.js';
import type {
  FindingActionKind,
  MultiAgentLatest,
  MultiAgentRun,
  PrIntentRecord,
  RunEventKind,
  RunFindingsPage,
  RunTrace,
} from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { ReviewRepository } from './repository.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import {
  decodeRunFindingsCursor,
  encodeRunFindingsCursor,
  findingRowToDto,
  reviewToDto,
  toMultiAgentRun,
  validateAgentIdsShape,
} from './helpers.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over container.runBus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private agents: Container['agentsRepo'];
  private executor: ReviewRunExecutor;

  /**
   * The repository is a constructor argument (B4), matching ReviewRunExecutor
   * below, which has always taken its repo and agents as arguments. The default
   * keeps the previous behaviour — a fresh ReviewRepository over container.db,
   * NOT container.reviewRepo, which is a separate instance of the same class.
   */
  constructor(
    private container: Container,
    private repo: ReviewRepository = new ReviewRepository(container.db),
  ) {
    this.agents = container.agentsRepo;
    this.executor = new ReviewRunExecutor(container, this.repo, this.agents);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. `all` → all enabled agents; `agentId` → that
   * one agent (even if disabled); `agent_ids` → a validated fan-out set.
   * Exactly one of the three may be present. Every check runs before anything
   * is written, and answers 400 (not Zod's 422 — see `validateAgentIdsShape`).
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean; agent_ids?: string[] },
  ): Promise<AgentRow[]> {
    const present = [opts.agentId, opts.all, opts.agent_ids].filter((v) => v !== undefined).length;
    if (present > 1) {
      throw new AppError('invalid_run_request', 'Provide only one of agentId, all or agent_ids', 400);
    }
    if (opts.agent_ids !== undefined) {
      const bad = validateAgentIdsShape(opts.agent_ids);
      if (bad) throw new AppError('invalid_run_request', bad, 400);
      const found = await this.agents.listByIds(workspaceId, opts.agent_ids);
      // listByIds is workspace-scoped, so a foreign or unknown id is simply absent.
      if (found.length !== opts.agent_ids.length) {
        throw new AppError('invalid_run_request', 'agent_ids contains an unknown agent', 400);
      }
      if (found.some((a) => !a.enabled)) {
        throw new AppError('invalid_run_request', 'agent_ids contains a disabled agent', 400);
      }
      // Preserve the caller's order (listByIds does not).
      const byId = new Map(found.map((a) => [a.id.toLowerCase(), a]));
      return opts.agent_ids.map((id) => byId.get(id.toLowerCase())!);
    }
    if (opts.all) return this.agents.listEnabled(workspaceId);
    if (opts.agentId) {
      const agent = await this.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new AppError('invalid_run_request', 'Provide agentId, all:true or agent_ids', 400);
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.repo.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.repo.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string) {
    return this.repo.listRunsForPull(workspaceId, prId);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.repo.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Signals a live runner to stop at its next
   * checkpoint AND marks the DB row cancelled + completes the bus immediately —
   * so cancel also works for ORPHANED runs (whose background process died on a
   * server restart) where signalling alone would do nothing.
   */
  async cancelRun(runId: string): Promise<void> {
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.container.runBus.cancel(runId);
    await this.repo.cancelRunIfRunning(runId);
    this.container.runBus.complete(runId);
  }

  /** Reap ALL runs left 'running' by a previous (now-dead) process. Called on boot. */
  async reapOrphanedRuns(): Promise<number> {
    return this.repo.reapOrphanedRunningRuns();
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: AgentRow[],
    logger?: Logger,
  ): Promise<{
    runs: { run_id: string; agent_id: string; agent_name: string }[];
    reviews: ReviewDto[];
    multi_run_id: string | null;
  }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    //
    // Two or more targets form a fan-out: one parent row, every child stamped
    // with its id, all created in ONE transaction so a half-made fan-out cannot
    // exist. A single target keeps the old path (no parent, column NULL).
    const fanOut = targets.length >= 2;
    const createRuns = async (repoTx: ReviewRepository, multiRunId: string | null) => {
      const runs: { run_id: string; agent_id: string; agent_name: string }[] = [];
      const jobs: { agent: AgentRow; runId: string }[] = [];
      for (const agent of targets) {
        const runId = await repoTx.createAgentRun({
          workspaceId,
          agentId: agent.id,
          prId,
          provider: agent.provider,
          model: agent.model,
          ...(multiRunId ? { multiRunId } : {}),
        });
        runs.push({ run_id: runId, agent_id: agent.id, agent_name: agent.name });
        jobs.push({ agent, runId });
      }
      return { runs, jobs };
    };
    const { runs, jobs, multiRunId } = fanOut
      ? await this.repo.transaction(async (tx) => {
          const parentId = await tx.createMultiAgentRun({ workspaceId, prId });
          return { ...(await createRuns(tx, parentId)), multiRunId: parentId as string | null };
        })
      : { ...(await createRuns(this.repo, null)), multiRunId: null as string | null };

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void this.executor.executeRuns(workspaceId, pull, repo, jobs, logger).catch((err) => {
      logger?.error({ prId, err: (err as Error).message }, 'review: background execution crashed');
    });

    return { runs, reviews: [], multi_run_id: multiRunId };
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.container.runBus.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.repo, workspaceId, findingId, action);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  /**
   * The intent derived for a PR, or null when none has been (spec 0008).
   *
   * Null is a normal answer, not an error: the classifier is fail-open, so a PR
   * that has never been reviewed — or whose classification failed — simply has
   * none. The UI renders nothing in that case.
   */
  async getIntent(workspaceId: string, prId: string): Promise<PrIntentRecord | null> {
    // Workspace check first: without it this would read another workspace's PR
    // by id, which the rubric counts as a CRITICAL.
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return (await this.repo.getIntent(prId)) ?? null;
  }

  async reviewsForPull(workspaceId: string, prId: string): Promise<ReviewDto[]> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.repo.reviewsForPull(prId);
    // One query for every agent named on this PR, rather than one per distinct
    // agent awaited in a loop (D11). The old loop was already deduped, so this
    // trades a handful of round-trips for one — not a hot-path rescue, but
    // there is no reason to pay per agent.
    const agentIds = [...new Set(rows.map(({ review }) => review.agentId).filter((id): id is string => !!id))];
    const names = new Map<string, string>(
      (await this.agents.listByIds(workspaceId, agentIds)).map((a) => [a.id, a.name]),
    );
    return rows.map(({ review, findings }) =>
      reviewToDto(review, findings, review.agentId ? names.get(review.agentId) : null),
    );
  }

  /** One fan-out with its columns and finding groups; 404 when absent or foreign. */
  async getMultiAgentRun(workspaceId: string, id: string): Promise<MultiAgentRun> {
    const parent = await this.repo.getMultiAgentRun(workspaceId, id);
    if (!parent) throw new NotFoundError('Multi-agent run not found');
    const children = await this.repo.childRunsForMultiRun(id);
    const reviews = await this.repo.reviewsWithFindingsForRuns(children.map((c) => c.runId));
    return toMultiAgentRun(parent, children, reviews);
  }

  /**
   * The newest fan-out of the workspace, or of one PR when `prId` is given. The
   * PR is resolved first so a foreign or unknown id is a 404, not an empty answer
   * (same guard as `getIntent`). No run is `{ run: null }`, a normal state.
   */
  async latestMultiAgentRun(workspaceId: string, prId?: string): Promise<MultiAgentLatest> {
    if (prId) {
      const pull = await this.repo.getPull(workspaceId, prId);
      if (!pull) throw new NotFoundError('Pull request not found');
    }
    const row = await this.repo.latestMultiAgentRun(workspaceId, prId);
    if (!row) return { run: null };
    return { run: { id: row.id, pr_id: row.prId, pr_number: row.prNumber, ran_at: row.ranAt.toISOString() } };
  }

  async getRunTrace(runId: string): Promise<RunTrace | undefined> {
    return this.repo.getRunTrace(runId);
  }

  /**
   * Findings for one run, filtered/paginated in SQL, plus the run's own
   * status — so a caller polling a still-running run (no findings persisted
   * yet: `insertReview` happens only on completion) needs one call, not a
   * findings fetch and a separate run-status fetch.
   */
  async getRunFindings(
    workspaceId: string,
    runId: string,
    query: { severity?: string[]; category?: string[]; limit: number; cursor?: string },
  ): Promise<RunFindingsPage> {
    // A cursor that does not decode is the caller's mistake, not a server
    // fault: fail it as a 400 rather than silently serving page one (mirrors
    // pulls/service.ts's handling of decodePullCursor).
    const cursor = query.cursor ? decodeRunFindingsCursor(query.cursor) : undefined;
    if (query.cursor && !cursor) {
      throw new AppError('invalid_cursor', 'Malformed pagination cursor.', 400);
    }

    const page = await this.repo.getRunFindingsPage(workspaceId, runId, {
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.category ? { category: query.category } : {}),
      limit: query.limit,
      ...(cursor ? { cursor } : {}),
    });
    if (!page) throw new NotFoundError('Run not found');

    const last = page.rows.at(-1);
    return {
      findings: page.rows.map(findingRowToDto),
      status: page.status,
      grounding: page.grounding,
      next_cursor: page.hasMore && last ? encodeRunFindingsCursor(last) : null,
    };
  }
}
