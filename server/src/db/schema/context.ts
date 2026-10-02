import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  vector,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { repos } from './repos';

// ============================================================ Context & codebase

/**
 * `symbols.name` and `references.to_symbol` are btree-indexed
 * (`symbols_repo_name_idx`, `references_repo_decl_symbol_idx`). Postgres rejects
 * any index row larger than ~2704 bytes, so a pathological multi-KB "name" from
 * a bad parse (e.g. a whole expression captured as an identifier) crashes the
 * indexer with `index row size … exceeds btree version 4 maximum`. Real
 * identifiers are short, so clamp these values well under the limit before
 * insert. 255 chars ≤ ~1 KB even for 4-byte code points — comfortably safe.
 */
export const MAX_INDEXED_NAME_LEN = 255;
export const clampIndexedName = (s: string): string =>
  s.length > MAX_INDEXED_NAME_LEN ? s.slice(0, MAX_INDEXED_NAME_LEN) : s;

export const codeChunks = pgTable(
  'code_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    source: text('source', { enum: ['code', 'docs', 'spec'] }).notNull().default('code'),
  },
  (t) => ({ repoIdx: index('code_chunks_repo_idx').on(t.repoId) }),
);

/**
 * `symbols` — declared identifiers (functions/classes/methods/etc.) per repo.
 *
 * T2 extension: added `endLine`, `exported`, `signature`,
 * `contentHash`. The new columns are nullable / defaulted so existing inserts
 * (blast/service.ts `persistSymbols`) keep typechecking; the T2 indexer
 * pipeline will backfill them on the next `refreshIndex`.
 *
 * `line` carries the `start_line` semantics — kept as-is so existing
 * rows survive the migration. The composite UNIQUE prevents duplicate
 * (repo, path, name, kind, line) tuples once the indexer takes over.
 */
export const symbols = pgTable(
  'symbols',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    line: integer('line'), // = start_line
    endLine: integer('end_line'), // [T2] NEW
    exported: boolean('exported').notNull().default(false), // [T2] NEW
    signature: text('signature'), // [T2] NEW
    contentHash: text('content_hash'), // [T2] NEW (nullable — backfilled by indexer)
  },
  (t) => ({
    lookupIdx: index('symbols_repo_path_idx').on(t.repoId, t.path),
    nameIdx: index('symbols_repo_name_idx').on(t.repoId, t.name),
    uq: uniqueIndex('symbols_repo_path_name_kind_line_uq').on(
      t.repoId,
      t.path,
      t.name,
      t.kind,
      t.line,
    ),
  }),
);

/**
 * `references` — call-sites / usages of symbols.
 *
 * T2 extension: added `declFile` (NULL = unresolved → feeds the
 * Phantom-gate) and `contentHash`. The legacy columns are untouched, so
 * blast/service.ts `persistReferences` keeps working.
 */
export const references = pgTable(
  'references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repos.id, { onDelete: 'cascade' }),
    fromPath: text('from_path').notNull(), // = ref_file
    toSymbol: text('to_symbol').notNull(), // = symbol_name
    line: integer('line').notNull(), // = ref_line
    declFile: text('decl_file'), // [T2] NEW — NULL = unresolved (Phantom-gate)
    contentHash: text('content_hash'), // [T2] NEW
  },
  (t) => ({
    byDecl: index('references_repo_decl_symbol_idx').on(
      t.repoId,
      t.declFile,
      t.toSymbol,
    ),
    byFile: index('references_repo_from_idx').on(t.repoId, t.fromPath),
  }),
);

/**
 * Onboarding tour (spec 0017). One row per repo. `json`/`generatedAt` carry the
 * LAST GOOD tour (the most recent generation that persisted its five
 * sections — `done` or `partial`); the five columns below track the CURRENT
 * generation, if any is in flight or just finished. Both halves share one row
 * on purpose: a failed regeneration must leave `json`/`generatedAt`
 * byte-identical (AC-58) while `status`/`reason` report the failure (AC-59).
 *
 * `json` is `notNull()`, so `claimGeneration`'s INSERT writes `json: {}` for a
 * repo generating for the first time (invariant I1 in the plan) — the DTO
 * mapper is the only place that turns "no `json.sections`" into a null
 * `generated_at` on the wire (invariant I2), because this column's own
 * `defaultNow()` is a storage artifact, not a generation timestamp.
 *
 * Four invariants every handler write must hold (plan decision 1):
 *   I1 — `claimGeneration` is the ONLY INSERT; every other write is an UPDATE
 *        guarded by `generation_id` + `status = 'running'`, so a repository
 *        deleted mid-generation (the FK below cascades) makes the final write
 *        affect zero rows instead of throwing 23503.
 *   I2 — `generated_at`'s wire value is null until `json.sections` exists;
 *        derived once, in the repository's DTO mapper.
 *   I3 — every write that moves `status` out of `running` is scoped by
 *        `WHERE repo_id = $r AND generation_id = $g AND status = 'running'`,
 *        so a generation whose row a later one has already claimed can never
 *        overwrite it (AC-17, AC-20).
 *   I4 — whichever write leaves `status <> 'running'` clears `started_at`,
 *        `job_id` AND `generation_id` in the same statement — a marker column
 *        not cleared by every writer is the exact failure mode recorded in
 *        server/INSIGHTS.md (2026-09-20, "A column used as a 'who decided
 *        this' marker must be cleared by the other writer").
 */
export const onboarding = pgTable('onboarding', {
  repoId: uuid('repo_id')
    .primaryKey()
    .references(() => repos.id, { onDelete: 'cascade' }),
  /** Last good tour's sections (`OnboardingSection[]`), or `{}` before one exists. */
  json: jsonb('json').notNull(),
  /** Last good tour's timestamp. A storage artifact until `json.sections` exists (I2). */
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  /** Current generation's status. `not_generated` is the pre-claim default. */
  status: text('status').notNull().default('not_generated'),
  /** Current generation's precondition/failure reason, or null. */
  reason: text('reason'),
  /** When the current generation was claimed. Drives AC-20's staleness check. */
  startedAt: timestamp('started_at', { withTimezone: true }),
  /** The enqueued job for the current generation, or null (AC-19's loser window). */
  jobId: uuid('job_id'),
  /**
   * Identity of the current generation. The guard in every handler write
   * (I3) — closes the late-settling-handler, the done-with-no-sections, and
   * the retried-after-success holes at once; see plan decision 1 / L1.
   */
  generationId: uuid('generation_id'),
});
