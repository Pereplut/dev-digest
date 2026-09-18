/**
 * Eval / conformance / compose tables — ROADMAP SCAFFOLDING, not yet wired.
 *
 * None of the four tables in this file is read or written anywhere in `src/`
 * outside the schema barrel and `db/seed.ts` (measured 2026-09-18). They are
 * kept on purpose — see the "ROADMAP SCAFFOLDING" note in `db/schema.ts` — but
 * nothing consumes them, so do not infer that eval runs or conformance checks
 * exist because their tables do, and hold off on indexes/constraints until
 * something queries them.
 *
 * Note for whoever wires this up: `eval_runs.cost_usd` is `doublePrecision`,
 * the same wrong-type-for-money problem as `agent_runs.cost_usd`. Convert them
 * together — see `docs/run-cost.md`.
 */
// Both: `doublePrecision` still serves recall/precision/citation_accuracy/
// completeness_pct (statistical ratios, where binary float is fine); `numeric`
// is only for cost_usd, which is money.
import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, doublePrecision, numeric } from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Eval / Conformance / Compose

export const evalCases = pgTable('eval_cases', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
  ownerId: uuid('owner_id').notNull(),
  name: text('name').notNull(),
  inputDiff: text('input_diff'),
  inputFiles: jsonb('input_files'),
  inputMeta: jsonb('input_meta'),
  expectedOutput: jsonb('expected_output'),
  notes: text('notes'),
});

export const evalRuns = pgTable('eval_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  caseId: uuid('case_id')
    .notNull()
    .references(() => evalCases.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  actualOutput: jsonb('actual_output'),
  pass: boolean('pass'),
  recall: doublePrecision('recall'),
  precision: doublePrecision('precision'),
  citationAccuracy: doublePrecision('citation_accuracy'),
  durationMs: integer('duration_ms'),
  // numeric, matching agent_runs.cost_usd — money must not be a binary float.
  // Free to change here: this table is roadmap scaffolding with no reads or
  // writes anywhere in src/ (see the note in db/schema.ts).
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
