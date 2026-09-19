import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, doublePrecision, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import { agents } from './agents';
import { agentRuns } from './runs';

// ============================================================ Review & findings

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    /**
     * FK added in migration 0013. Mirrors `agent_runs.agent_id`: deleting an
     * agent keeps its reviews but forgets which agent produced them, rather
     * than leaving a dangling uuid that `reviews/service.ts` then looks up and
     * silently gets no name for.
     */
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    /**
     * The agent_run that produced this review (links the timeline run ↔ review).
     *
     * FK added in migration 0013. `cascade` encodes in the schema what
     * `run.repo.ts deleteAgentRun` had to do by hand: without it, deleting a run
     * left its review — and the review's findings, which DO cascade from
     * `reviews` — orphaned in the Review Runs list.
     */
    runId: uuid('run_id').references(() => agentRuns.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
    verdict: text('verdict'),
    summary: text('summary'),
    score: integer('score'),
    model: text('model'),
    createdAt: now(),
  },
  (t) => ({
    // PR list: the latest review round's findings are joined via run_id.
    runIdx: index('reviews_run_id_idx').on(t.runId),
    // PR detail — `WHERE pr_id = ? ORDER BY created_at DESC`
    // (repository/review.repo.ts reviewsForPull), run on every page load and
    // previously a seq scan. No `.desc()`: Postgres scans a btree backwards,
    // so a plain (pr_id, created_at) index already serves the DESC order.
    prCreatedIdx: index('reviews_pr_created_idx').on(t.prId, t.createdAt),
    // PR list — `WHERE workspace_id = ? AND pr_id IN (…) AND kind = 'review'`
    // (modules/pulls/routes.ts), also previously a seq scan.
    wsPrKindIdx: index('reviews_ws_pr_kind_idx').on(t.workspaceId, t.prId, t.kind),
  }),
);

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    file: text('file').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    severity: text('severity').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    rationale: text('rationale').notNull(),
    suggestion: text('suggestion'),
    confidence: doublePrecision('confidence').notNull(),
    kind: text('kind').notNull().default('finding'),
    trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  // Postgres doesn't index FKs: the PR-list counts and reviewsForPull join on it.
  (t) => ({ reviewIdx: index('findings_review_id_idx').on(t.reviewId) }),
);

export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
});

export const prBrief = pgTable('pr_brief', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  json: jsonb('json').notNull(),
});
