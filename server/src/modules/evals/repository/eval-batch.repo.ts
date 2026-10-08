import { and, desc, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { EvalRunBatchRow, EvalRunRow } from '../../../db/rows.js';
import { ConflictError } from '../../../platform/errors.js';

export type { EvalRunBatchRow, EvalRunRow };

/**
 * `eval_run_batches` + `eval_runs` data-access (spec 0019). The only file here
 * allowed to import drizzle-orm, matching `eval-case.repo.ts`.
 *
 * `cost_usd` crosses the repository boundary as a STRING: Drizzle 0.38
 * `numeric()` has no `mode: 'number'` (server/INSIGHTS.md:144-150), exactly as
 * `reviews/repository/run.repo.ts:67,186` handles `agent_runs.cost_usd` —
 * `Number()` on read, `String()` on write, never a float accumulator here.
 */

const LIVE_STATUSES = ['queued', 'running'] as const;

/** Postgres unique_violation, possibly wrapped by the driver/ORM. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

export interface InsertQueuedBatch {
  workspaceId: string;
  ownerKind: 'agent' | 'skill';
  ownerId: string;
  agentId: string;
  agentVersion: number;
  casesTotal: number;
  /** spec 0020 AC-3 — the caller passes `EVAL_METRICS_VERSION`, never a literal. */
  metricsVersion: number;
}

export interface CompleteTerminalValues {
  status: 'done' | 'failed' | 'cancelled';
  error?: string | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  casesPassed: number;
  durationMs: number | null;
  /** Plain number in, `numeric` string out (see file header). */
  costUsd: number | null;
}

export interface InsertCaseRunValues {
  caseId: string;
  batchId: string;
  actualOutput: unknown;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number | null;
  /** Plain number in, `numeric` string out (see file header). */
  costUsd: number | null;
}

export class EvalBatchRepository {
  constructor(private db: DbOrTx) {}

  /**
   * Queue a new batch. Throws `ConflictError` if a live (`queued`/`running`)
   * batch already exists for this owner — the partial unique index
   * (`eval_run_batches_owner_live_uq`, AC-76) is the database-level backstop
   * for `EvalService.queueBatch`'s own read-then-write guard (AC-34).
   */
  async insertQueued(values: InsertQueuedBatch): Promise<EvalRunBatchRow> {
    try {
      const [row] = await this.db
        .insert(t.evalRunBatches)
        .values({
          workspaceId: values.workspaceId,
          ownerKind: values.ownerKind,
          ownerId: values.ownerId,
          agentId: values.agentId,
          agentVersion: values.agentVersion,
          status: 'queued',
          casesTotal: values.casesTotal,
          metricsVersion: values.metricsVersion,
        })
        .returning();
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('An eval run is already queued or running for this agent');
      }
      throw err;
    }
  }

  async markRunning(id: string): Promise<void> {
    await this.db
      .update(t.evalRunBatches)
      .set({ status: 'running' })
      .where(eq(t.evalRunBatches.id, id));
  }

  /**
   * The ONE terminal write (R55/AC-44) — status + the rolled-up metrics,
   * together. Scoped to a still-live row: a second terminal write (e.g. the
   * executor's catch-all firing after this one already landed `done`) is a
   * no-op rather than an overwrite that would strip the rollup and reopen
   * `error` to a later, unrelated failure.
   */
  async completeTerminal(id: string, values: CompleteTerminalValues): Promise<void> {
    await this.db
      .update(t.evalRunBatches)
      .set({
        status: values.status,
        error: values.error ?? null,
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        casesPassed: values.casesPassed,
        durationMs: values.durationMs,
        costUsd: values.costUsd == null ? null : String(values.costUsd),
      })
      .where(and(eq(t.evalRunBatches.id, id), inArray(t.evalRunBatches.status, [...LIVE_STATUSES])));
  }

  /**
   * Fail a batch with a terminal `failed` row and no rollup numbers. Used both
   * BEFORE any case ran (AC-40, provider resolution) and as the executor's
   * catch-all for anything that escapes the sweep after that (AC-44 — a batch
   * must always reach exactly one terminal status, never strand in `running`).
   * Scoped to a still-live row for the same reason as `completeTerminal`.
   */
  async failImmediately(id: string, error: string): Promise<void> {
    await this.db
      .update(t.evalRunBatches)
      .set({ status: 'failed', error })
      .where(and(eq(t.evalRunBatches.id, id), inArray(t.evalRunBatches.status, [...LIVE_STATUSES])));
  }

  /** One batch, scoped to the workspace — `undefined` if unknown or another workspace's (AC-30). */
  async getScoped(workspaceId: string, id: string): Promise<EvalRunBatchRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRunBatches)
      .where(and(eq(t.evalRunBatches.workspaceId, workspaceId), eq(t.evalRunBatches.id, id)));
    return row;
  }

  /**
   * The batch plus its per-case runs (AC-35), workspace-scoped, in at most two
   * queries — the `## Non-functional` no-N+1 rule.
   */
  async getWithRuns(
    workspaceId: string,
    id: string,
  ): Promise<{ batch: EvalRunBatchRow; runs: (EvalRunRow & { caseName: string | null })[] } | undefined> {
    const batch = await this.getScoped(workspaceId, id);
    if (!batch) return undefined;
    const rows = await this.db
      .select({ run: t.evalRuns, caseName: t.evalCases.name })
      .from(t.evalRuns)
      .leftJoin(t.evalCases, eq(t.evalCases.id, t.evalRuns.caseId))
      .where(eq(t.evalRuns.batchId, id));
    return { batch, runs: rows.map(({ run, caseName }) => ({ ...run, caseName: caseName ?? null })) };
  }

  /** An owner's batches, newest first (AC-68) — the Evals tab reads element 0. */
  async listForAgent(workspaceId: string, ownerId: string): Promise<EvalRunBatchRow[]> {
    return this.db
      .select()
      .from(t.evalRunBatches)
      .where(and(eq(t.evalRunBatches.workspaceId, workspaceId), eq(t.evalRunBatches.ownerId, ownerId)))
      .orderBy(desc(t.evalRunBatches.ranAt));
  }

  /** Whether a `queued`/`running` batch already exists for this owner (AC-34's service-level guard). */
  async hasLiveBatch(ownerId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.evalRunBatches.id })
      .from(t.evalRunBatches)
      .where(
        and(eq(t.evalRunBatches.ownerId, ownerId), inArray(t.evalRunBatches.status, [...LIVE_STATUSES])),
      );
    return row !== undefined;
  }

  /**
   * spec 0020 AC-34 — whether a `queued`/`running` batch exists for this
   * AGENT, keyed on `agent_id` rather than `owner_id` (server/INSIGHTS.md —
   * `hasLiveBatch` above is owner-keyed so a future skill-owned batch still
   * blocks the right owner; promote's guard is specifically about THIS
   * agent's config changing underneath a live sweep, so it must key on
   * `agent_id` even once a batch can be owned by a skill). Consumed only
   * through `Container.evalBatchRepo` (spec 0020 `## Decisions I settled` #1)
   * — `modules/agents/` never imports this repository directly.
   */
  async hasLiveBatchForAgent(agentId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.evalRunBatches.id })
      .from(t.evalRunBatches)
      .where(
        and(eq(t.evalRunBatches.agentId, agentId), inArray(t.evalRunBatches.status, [...LIVE_STATUSES])),
      );
    return row !== undefined;
  }

  /**
   * spec 0020 AC-20/AC-21 — both named batches, scoped to the workspace AND
   * this agent, in one `inArray` query. A batch that belongs to a different
   * agent or a different workspace simply does not come back, so the caller
   * can tell "found both" from "found one or zero" without a second query.
   */
  async getPairScoped(
    workspaceId: string,
    agentId: string,
    ids: [string, string],
  ): Promise<EvalRunBatchRow[]> {
    return this.db
      .select()
      .from(t.evalRunBatches)
      .where(
        and(
          eq(t.evalRunBatches.workspaceId, workspaceId),
          eq(t.evalRunBatches.agentId, agentId),
          inArray(t.evalRunBatches.id, ids),
        ),
      );
  }

  /** One case's execution within a batch (AC-41). */
  async insertCaseRun(values: InsertCaseRunValues): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        batchId: values.batchId,
        actualOutput: values.actualOutput as object | null,
        pass: values.pass,
        recall: values.recall,
        precision: values.precision,
        citationAccuracy: values.citationAccuracy,
        durationMs: values.durationMs,
        costUsd: values.costUsd == null ? null : String(values.costUsd),
      })
      .returning();
    return row!;
  }

  /**
   * Boot reap (AC-72): every batch still `queued`/`running` is orphaned by a
   * restart — mark it `failed` with an `error` naming why, so AC-34's guard
   * cannot block that owner forever.
   */
  async failOrphaned(error: string): Promise<number> {
    const rows = await this.db
      .update(t.evalRunBatches)
      .set({ status: 'failed', error })
      .where(inArray(t.evalRunBatches.status, [...LIVE_STATUSES]))
      .returning({ id: t.evalRunBatches.id });
    return rows.length;
  }
}
