/**
 * Eval harness tables (spec 0019) + conformance/compose — ROADMAP SCAFFOLDING
 * for the latter two only.
 *
 * `eval_cases`, `eval_runs` and `eval_run_batches` are LIVE as of spec 0019:
 * `modules/evals/` reads and writes all three. The "reshape freely, nothing
 * reads this" licence that used to cover this whole file is revoked for them —
 * a schema change here now needs the same care as any other live table
 * (`pnpm db:generate` + `pnpm db:migrate`, no hand-edited migrations).
 *
 * `conformance_checks` and `composed_reviews` remain unread outside the schema
 * barrel and `db/seed.ts` (measured 2026-09-18, re-checked 2026-10-07) — the
 * roadmap-scaffolding caveat in `db/schema.ts` still applies to those two.
 */
// Both: `doublePrecision` still serves recall/precision/citation_accuracy/
// completeness_pct (statistical ratios, where binary float is fine); `numeric`
// is only for cost_usd, which is money.
import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  numeric,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';

// ============================================================ Eval / Conformance / Compose

export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    // Polymorphic — points at a skill or an agent id depending on ownerKind, so
    // it carries no FK (matches the eval_run_batches.ownerId below).
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    inputDiff: text('input_diff'),
    inputFiles: jsonb('input_files'),
    inputMeta: jsonb('input_meta'),
    expectedOutput: jsonb('expected_output'),
    notes: text('notes'),
    // spec 0019 — what a produced finding is checked against.
    expectationKind: text('expectation_kind', { enum: ['must_find', 'must_not_flag'] }).notNull(),
    expectedFile: text('expected_file').notNull(),
    expectedStartLine: integer('expected_start_line').notNull(),
    expectedEndLine: integer('expected_end_line').notNull(),
    // The finding this case was born from. Nullable: a hand-written case (0020)
    // has none. No FK — a finding is deletable and this column is a provenance
    // marker, not a referential one; losing the finding must not cascade-delete
    // the case it produced.
    sourceFindingId: uuid('source_finding_id'),
    createdAt: now(),
  },
  (t) => ({
    // AC-64 — one eval case per (owner, finding); a reload or double-click on
    // the same finding must not create a second case. Partial so hand-written
    // cases (source_finding_id null) are unconstrained by it — the standard
    // idiom for a nullable unique column (`nullsNotDistinct()` exists only on
    // the unique-CONSTRAINT builder, not on `uniqueIndex`; server/INSIGHTS.md:138-144).
    ownerSourceUq: uniqueIndex('eval_cases_owner_source_uq')
      .on(t.ownerId, t.sourceFindingId)
      .where(sql`source_finding_id is not null`),
  }),
);

/** One sweep of an owner's eval cases by one agent version (spec 0019). */
export const evalRunBatches = pgTable(
  'eval_run_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    // Polymorphic, same shape as eval_cases.ownerId — no FK.
    ownerId: uuid('owner_id').notNull(),
    // The concrete agent (+ version) that actually executed this sweep. Every
    // 0019 row has owner_kind='agent' and agent_id === owner_id; kept distinct
    // from ownerId so a future skill-owned batch (0020) still names the agent
    // that ran it.
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    agentVersion: integer('agent_version').notNull(),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    status: text('status', {
      enum: ['queued', 'running', 'done', 'failed', 'cancelled'],
    })
      .notNull()
      .default('queued'),
    error: text('error'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    casesTotal: integer('cases_total').notNull(),
    casesPassed: integer('cases_passed').notNull().default(0),
    durationMs: integer('duration_ms'),
    // numeric, not doublePrecision — same reasoning as agent_runs.cost_usd:
    // this is summed across cases and money must not be a binary float.
    // Drizzle 0.38 has no `mode: 'number'`, so it round-trips as a STRING;
    // convert at the repository boundary (Number() on read, String() on write).
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
  },
  (t) => ({
    // AC-76 — closes the two-concurrent-batches race in the database: a
    // second POST /agents/:id/eval-runs while one is already queued/running
    // fails this unique index, not just the service's read-then-write guard.
    ownerLiveUq: uniqueIndex('eval_run_batches_owner_live_uq')
      .on(t.ownerId)
      .where(sql`status in ('queued', 'running')`),
  }),
);

export const evalRuns = pgTable('eval_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id')
    .notNull()
    .references(() => evalCases.id, { onDelete: 'cascade' }),
  // spec 0019 — every eval_runs row is one case's execution inside one batch.
  batchId: uuid('batch_id')
    .notNull()
    .references(() => evalRunBatches.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  actualOutput: jsonb('actual_output'),
  pass: boolean('pass'),
  recall: doublePrecision('recall'),
  precision: doublePrecision('precision'),
  citationAccuracy: doublePrecision('citation_accuracy'),
  durationMs: integer('duration_ms'),
  // numeric, matching agent_runs.cost_usd — money must not be a binary float.
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
});

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
