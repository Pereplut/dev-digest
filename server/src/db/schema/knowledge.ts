import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  doublePrecision,
  boolean,
  integer,
  numeric,
  vector,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

// ============================================================ Conventions (spec 0007)

export const CONVENTION_CATEGORIES = [
  'naming',
  'structure',
  'error-handling',
  'async',
  'testing',
  'api',
  'data',
  'style',
] as const;

export const CONVENTION_STATUSES = ['pending', 'accepted', 'rejected'] as const;

/**
 * One run of the extractor over a repo. This is the POLLABLE status surface:
 * the `jobs` table is write-only (nothing SELECTs it — see platform/jobs.ts),
 * so the page cannot watch a job id. The row is inserted synchronously by the
 * route before the job is enqueued, so there is always something to poll.
 */
export const conventionScans = pgTable(
  'convention_scans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['running', 'done', 'failed'] })
      .notNull()
      .default('running'),
    /**
     * Which sampler produced the file list: `repo-intel` is the graded path
     * (configs + `getConventionSamples`), `walk` the deterministic fallback used
     * when the repo has never been indexed.
     */
    sampler: text('sampler', { enum: ['repo-intel', 'walk'] }).notNull().default('repo-intel'),
    sampleFileCount: integer('sample_file_count').notNull().default(0),
    candidateCount: integer('candidate_count').notNull().default(0),
    rejectedCount: integer('rejected_count').notNull().default(0),
    model: text('model'),
    /** numeric → STRING in Drizzle 0.38; converted at the row↔DTO boundary. */
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    error: text('error'),
    /**
     * Named `started_at`, not the shared `now()` helper: that helper hardcodes
     * the column name `created_at` (schema/_shared.ts), which would leave the
     * DB showing a `created_at`/`finished_at` pair while the code and every
     * query talk about a scan that started and finished.
     */
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({ repoIdx: index('convention_scans_repo_idx').on(t.repoId) }),
);

/**
 * A house-convention candidate proposed by the extractor.
 *
 * `fingerprint` is a stable hash of (evidence_path + normalised rule) — NOT of
 * the line numbers or the confidence — so a re-scan that finds the same rule at
 * a shifted line UPDATES the row instead of duplicating it, and the user's
 * accept/reject decision survives. That is what the unique key below enforces.
 */
export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /**
     * NOT NULL because it leads the unique merge key below. Postgres UNIQUE is
     * NULLS DISTINCT, so a nullable repo_id would make that key enforce nothing
     * for workspace-level rows and `ON CONFLICT (repo_id, fingerprint)` would
     * never match them — every re-scan would insert a duplicate and lose the
     * user's accept/reject decision.
     */
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    scanId: uuid('scan_id').references(() => conventionScans.id, { onDelete: 'set null' }),
    category: text('category', { enum: CONVENTION_CATEGORIES }).notNull().default('style'),
    rule: text('rule').notNull(),
    evidencePath: text('evidence_path'),
    evidenceStartLine: integer('evidence_start_line'),
    evidenceEndLine: integer('evidence_end_line'),
    evidenceSnippet: text('evidence_snippet'),
    confidence: doublePrecision('confidence'),
    status: text('status', { enum: CONVENTION_STATUSES }).notNull().default('pending'),
    /** False when code-side proof failed; `rejectedReason` says which check. */
    evidenceValid: boolean('evidence_valid').notNull().default(false),
    rejectedReason: text('rejected_reason'),
    fingerprint: text('fingerprint').notNull(),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    repoIdx: index('conventions_repo_idx').on(t.repoId),
    repoFingerprintUq: unique('conventions_repo_fingerprint_uq').on(t.repoId, t.fingerprint),
  }),
);
