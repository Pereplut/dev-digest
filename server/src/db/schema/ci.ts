/**
 * CI integration tables — ROADMAP SCAFFOLDING, not yet wired.
 *
 * Neither table in this file is read or written anywhere in `src/` outside the
 * schema barrel and `db/seed.ts` (measured 2026-09-18). They are kept on
 * purpose — see the "ROADMAP SCAFFOLDING" note in `db/schema.ts` — but nothing
 * consumes them, so do not infer that CI reporting exists because these tables
 * do, and hold off on indexes/constraints here until something queries them.
 *
 * Note for whoever wires this up: `ci_runs.cost_usd` is `doublePrecision`, the
 * same wrong-type-for-money problem as `agent_runs.cost_usd`. Convert both to
 * `numeric(12,6)` together — see `docs/run-cost.md`.
 */
import { pgTable, uuid, text, integer, timestamp, numeric } from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const ciInstallations = pgTable('ci_installations', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  repo: text('repo').notNull(),
  targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
  installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ciRuns = pgTable('ci_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
    onDelete: 'set null',
  }),
  prNumber: integer('pr_number'),
  ranAt: timestamp('ran_at', { withTimezone: true }),
  status: text('status'),
  findingsCount: integer('findings_count'),
  // numeric, matching agent_runs.cost_usd — money must not be a binary float.
  // Free to change here: this table is roadmap scaffolding with no reads or
  // writes anywhere in src/ (see the note in db/schema.ts).
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
  githubUrl: text('github_url'),
  source: text('source'),
});
