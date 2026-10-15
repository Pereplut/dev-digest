/**
 * CI integration tables.
 *
 * `ci_installations` is WIRED (spec 0022, `modules/ci`): one row per
 * (agent, repo) export. `ci_runs` is still unused scaffolding — ingested CI
 * results are `agent_runs` rows with `source = 'ci'` (see `runs.ts`), so do not
 * write to `ci_runs`.
 *
 * Note for whoever wires `ci_runs` up: `ci_runs.cost_usd` is `numeric(12,6)`,
 * matching `agent_runs.cost_usd`; Drizzle returns it as a STRING.
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  numeric,
  unique,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const ciInstallations = pgTable(
  'ci_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
    // Enums are TypeScript-only (no DB CHECK) — enforced by the Zod contract.
    status: text('status', { enum: ['pr_open', 'active', 'error'] })
      .notNull()
      .default('pr_open'),
    /** Starts at 1; +1 on every successful re-export. */
    workflowVersion: integer('workflow_version').notNull().default(1),
    triggers: jsonb('triggers').$type<string[]>().notNull(),
    postAs: text('post_as', { enum: ['github_review', 'pr_comment', 'none'] })
      .notNull()
      .default('github_review'),
    /** GitHub repository id; an ingested artifact must carry the same one. */
    repositoryId: bigint('repository_id', { mode: 'number' }).notNull(),
    prUrl: text('pr_url'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    agentRepoUq: unique('ci_installations_agent_repo_uq').on(t.agentId, t.repo),
  }),
);

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
