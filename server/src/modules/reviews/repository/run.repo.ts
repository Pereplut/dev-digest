import { and, desc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import { AppError } from '../../../platform/errors.js';
import type { RunSummary } from '@devdigest/shared';
import { RunTrace as RunTraceSchema, type RunTrace } from '@devdigest/shared';

// Every function takes `DbOrTx` so a caller can compose several of them into a
// single transaction (see ReviewRepository.transaction). Passing the pool keeps
// the previous auto-commit behaviour.

// ---- in-flight / history --------------------------------------------------

/** In-flight runs for a PR (status='running') — the server-side source of
 *  truth for "which agents are running now". Joined with the agent name. */
export async function activeRunsForPull(
  db: DbOrTx,
  workspaceId: string,
  prId: string,
): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
  const rows = await db
    .select({
      id: t.agentRuns.id,
      agentId: t.agentRuns.agentId,
      ranAt: t.agentRuns.ranAt,
      agentName: t.agents.name,
    })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.prId, prId),
        eq(t.agentRuns.status, 'running'),
      ),
    );
  return rows.map((r) => ({
    run_id: r.id,
    agent_id: r.agentId,
    agent_name: r.agentName ?? null,
    ran_at: r.ranAt ? r.ranAt.toISOString() : null,
  }));
}

/** All runs for a PR (any status), newest first — the PR run history. */
export async function listRunsForPull(
  db: DbOrTx,
  workspaceId: string,
  prId: string,
): Promise<RunSummary[]> {
  const rows = await db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.prId, prId)))
    .orderBy(desc(t.agentRuns.ranAt));
  return rows.map(({ run, agentName }) => ({
    run_id: run.id,
    agent_id: run.agentId,
    agent_name: agentName ?? null,
    provider: run.provider,
    model: run.model,
    status: run.status,
    error: run.error,
    duration_ms: run.durationMs,
    tokens_in: run.tokensIn,
    tokens_out: run.tokensOut,
    // `cost_usd` is `numeric` in Postgres, which Drizzle 0.38 surfaces as a
    // STRING (it has no `mode: 'number'`). The RunSummary contract declares
    // `z.number()`, and no route has a response schema to catch a violation at
    // runtime — so convert here, at the row↔DTO boundary, not in the callers.
    cost_usd: run.costUsd == null ? null : Number(run.costUsd),
    findings_count: run.findingsCount,
    grounding: run.grounding,
    ran_at: run.ranAt ? run.ranAt.toISOString() : null,
    score: run.score,
    blockers: run.blockers,
  }));
}

/**
 * Delete one agent run. Workspace-scoped.
 *
 * The run's trace, the review it produced, and that review's findings all go
 * with it via FK cascades — `run_traces.run_id` and (since migration 0013)
 * `reviews.run_id`, from which `findings.review_id` cascades in turn.
 *
 * This used to delete the review explicitly in a transaction, because
 * `reviews.run_id` had no foreign key and a failure between the two statements
 * left a run whose findings had silently vanished. Migration 0013 added that FK
 * with ON DELETE CASCADE, so the database now enforces the invariant and a
 * single statement is atomic on its own.
 *
 * The old explicit delete was workspace-scoped and the cascade is not, which is
 * a difference on paper only: a review's workspace always matches its run's
 * (verified across every row before the FK was added), and the cascade is
 * arguably more correct — no review should outlive the run that produced it.
 *
 * Covered by `test/reviews.it.test.ts` "DELETE /runs/:id removes the run AND
 * its review + findings", which was written against the previous two-step
 * implementation and passes unchanged here.
 */
export async function deleteAgentRun(
  db: DbOrTx,
  workspaceId: string,
  runId: string,
): Promise<boolean> {
  const rows = await db
    .delete(t.agentRuns)
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId)))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** Mark a still-running run as cancelled (no-op if it already finished). */
export async function cancelRunIfRunning(db: DbOrTx, runId: string): Promise<boolean> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'cancelled' })
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.status, 'running')))
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** On boot: any run still 'running' is orphaned (its process died / restarted),
 *  so mark it failed. Prevents permanently stuck "running" runs in the UI. */
export async function reapStaleRunningRuns(db: DbOrTx): Promise<number> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'failed' })
    .where(eq(t.agentRuns.status, 'running'))
    .returning({ id: t.agentRuns.id });
  return rows.length;
}

// ---- observability: agent_runs + run_traces -------------------------------

/** Create an agent_runs row in `running` state; returns its id (= the runId). */
export async function createAgentRun(
  db: DbOrTx,
  values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
  },
): Promise<string> {
  const [row] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: values.workspaceId,
      agentId: values.agentId,
      prId: values.prId,
      provider: values.provider,
      model: values.model,
      status: 'running',
      source: 'local',
    })
    .returning({ id: t.agentRuns.id });
  return row!.id;
}

export async function completeAgentRun(
  db: DbOrTx,
  runId: string,
  values: {
    status: 'done' | 'failed' | 'cancelled';
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    /** USD spent (provider-reported or usage × pricing); null when unknown. */
    costUsd?: number | null;
    findingsCount: number;
    grounding: string;
    /** Review score (0-100); null on failed/cancelled runs. */
    score?: number | null;
    /** Findings that tripped the agent's gate; 0 on failed/cancelled runs. */
    blockers?: number | null;
    /** Failure reason (status='failed') / cancellation note. Null clears it. */
    error?: string | null;
  },
): Promise<void> {
  await db
    .update(t.agentRuns)
    .set({
      status: values.status,
      durationMs: values.durationMs,
      tokensIn: values.tokensIn,
      tokensOut: values.tokensOut,
      // Callers keep passing `number | null` (see the signature above); the
      // string conversion for the `numeric` column is contained here.
      costUsd: values.costUsd == null ? null : String(values.costUsd),
      findingsCount: values.findingsCount,
      grounding: values.grounding,
      score: values.score ?? null,
      blockers: values.blockers ?? null,
      error: values.error ?? null,
    })
    .where(eq(t.agentRuns.id, runId));
}

/** Which skills (and versions) went into one run's prompt, in prompt order. */
export interface RunSkillValues {
  order: number;
  skillId: string | null;
  skillName: string;
  version: number;
  tokens: number;
}

/** Record a run's skills (spec 0006) — the relational source for skill stats. */
export async function insertRunSkills(
  db: DbOrTx,
  runId: string,
  skills: RunSkillValues[],
): Promise<void> {
  if (skills.length === 0) return;
  await db.insert(t.runSkills).values(skills.map((s) => ({ runId, ...s })));
}

/** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
export async function saveRunTrace(
  db: DbOrTx,
  runId: string,
  trace: RunTrace,
): Promise<void> {
  await db
    .insert(t.runTraces)
    .values({ runId, trace })
    .onConflictDoUpdate({ target: t.runTraces.runId, set: { trace } });
}

/**
 * Read-side schema for stored traces. Traces written before a list field
 * existed are historical data we cannot retro-fix, and the drawer should still
 * open, so those fields default to empty here. Everything else must match, so
 * the output genuinely IS a RunTrace — no cast. The strict shape is enforced
 * at WRITE time via buildRunTrace.
 */
const StoredRunTrace = RunTraceSchema.extend({
  tool_calls: RunTraceSchema.shape.tool_calls.default([]),
  raw_output: RunTraceSchema.shape.raw_output.default(''),
  memory_pulled: RunTraceSchema.shape.memory_pulled.default([]),
  specs_read: RunTraceSchema.shape.specs_read.default([]),
  log: RunTraceSchema.shape.log.default([]),
});

export async function getRunTrace(db: DbOrTx, runId: string): Promise<RunTrace | undefined> {
  const [row] = await db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
  if (!row) return undefined;
  const parsed = StoredRunTrace.safeParse(row.trace);
  if (!parsed.success) {
    // Say so rather than hand the client a shape the parse just rejected.
    throw new AppError('trace_corrupt', 'Stored run trace does not match the trace schema', 500);
  }
  return parsed.data;
}
