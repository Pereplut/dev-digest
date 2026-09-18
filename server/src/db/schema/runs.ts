import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, index } from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';

// ============================================================ Observability

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    provider: text('provider'),
    model: text('model'),
    durationMs: integer('duration_ms'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    /** USD spent on this run (provider-reported, or usage × pricing); null when
        the price is unknown or the run failed/was cancelled — the UI shows "—". */
    costUsd: doublePrecision('cost_usd'),
    status: text('status'),
    /** Failure reason when status='failed' (LLM/API error, timeout, quota, …). */
    error: text('error'),
    source: text('source', { enum: ['local', 'ci'] }).notNull().default('local'),
    findingsCount: integer('findings_count'),
    grounding: text('grounding'),
    /** Review score (0-100) for this run; null on failed/cancelled runs. */
    score: integer('score'),
    /** Findings that tripped the agent's gate (severity ≥ ciFailOn). */
    blockers: integer('blockers'),
  },
  (t) => ({
    // PR list: newest run per (PR, agent) for the latest review round cost.
    prAgentRanIdx: index('agent_runs_pr_agent_ran_idx').on(t.prId, t.agentId, t.ranAt),
    // PR detail — `WHERE workspace_id = ? AND pr_id = ? ORDER BY ran_at DESC`
    // (repository/run.repo.ts listRunsForPull). The index above cannot serve
    // this: `agent_id` sits between `pr_id` and `ran_at`, so the ordering is
    // not a usable prefix and every PR-detail load forced a sort.
    prRanIdx: index('agent_runs_pr_ran_idx').on(t.prId, t.ranAt),
    // PR list cost rollup — `WHERE … AND status = 'done' GROUP BY pr_id`
    // (modules/pulls/routes.ts). Partial so it stays small: only `done` runs
    // are ever summed, and failed/cancelled/running rows are never counted.
    prDoneIdx: index('agent_runs_pr_done_idx')
      .on(t.prId)
      .where(sql`status = 'done'`),
  }),
);

/** Whole trace of one run as a SINGLE jsonb document. */
export const runTraces = pgTable('run_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  trace: jsonb('trace').notNull(),
});

export const multiAgentRuns = pgTable('multi_agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
});
