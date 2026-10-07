import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

/**
 * Schema-level integration test for spec 0019's migration (S10): inserts
 * against the MIGRATED database (migrations are not applied on boot,
 * `server/INSIGHTS.md:9-15`), one layer below any service/repository code.
 *
 * AC-1, AC-2, AC-3, AC-4, AC-63, AC-64, AC-76.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[evals-schema] Docker not available — skipping integration tests.');
}

d('eval schema (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let agentId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
    const [agent] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId)).limit(1);
    agentId = agent!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  /** A fresh case + batch pair, so each test starts from a clean slate. */
  async function insertCase(overrides: Partial<typeof t.evalCases.$inferInsert> = {}) {
    const [row] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agentId,
        name: 'case',
        expectationKind: 'must_find',
        expectedFile: 'src/a.ts',
        expectedStartLine: 1,
        expectedEndLine: 5,
        ...overrides,
      })
      .returning();
    return row!;
  }

  /**
   * `owner_id` defaults to a FRESH random uuid per call — it carries no FK, so
   * any value is valid, and a fresh one per test keeps the AC-76 live-batch
   * partial unique index from leaking across tests that don't mean to share an
   * owner. Tests exercising that index pass an explicit, shared `ownerId`.
   */
  async function insertBatch(overrides: Partial<typeof t.evalRunBatches.$inferInsert> = {}) {
    const [row] = await pg.handle.db
      .insert(t.evalRunBatches)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: randomUUID(),
        agentId,
        agentVersion: 1,
        casesTotal: 1,
        ...overrides,
      })
      .returning();
    return row!;
  }

  it('inserts a batch, a case and a run, and the full column set round-trips (AC-1, AC-2, AC-3, AC-63)', async () => {
    const batch = await insertBatch();
    const evalCase = await insertCase({ sourceFindingId: null });
    const [run] = await pg.handle.db
      .insert(t.evalRuns)
      .values({ caseId: evalCase.id, batchId: batch.id, pass: true })
      .returning();

    expect(evalCase).toMatchObject({
      expectationKind: 'must_find',
      expectedFile: 'src/a.ts',
      expectedStartLine: 1,
      expectedEndLine: 5,
      sourceFindingId: null,
    });
    expect(evalCase.createdAt).toBeInstanceOf(Date);
    expect(run!.batchId).toBe(batch.id);
    expect(batch.ranAt).toBeInstanceOf(Date);
  });

  it('cost_usd round-trips 0.000001 exactly and a ratio accepts 0.3333333333 (AC-4)', async () => {
    const batch = await insertBatch({ costUsd: '0.000001', recall: 0.3333333333 });
    const [reread] = await pg.handle.db.select().from(t.evalRunBatches).where(eq(t.evalRunBatches.id, batch.id));
    // Drizzle 0.38 `numeric()` has no `mode: 'number'` — it round-trips as a
    // string (server/INSIGHTS.md:144-150); the repository boundary (S13)
    // converts with Number()/String(), not this test.
    expect(reread!.costUsd).toBe('0.000001');
    expect(reread!.recall).toBeCloseTo(0.3333333333, 10);
  });

  it('rejects two cases with the same (owner_id, source_finding_id) (AC-64)', async () => {
    const findingId = '00000000-0000-0000-0000-000000000001';
    await insertCase({ sourceFindingId: findingId, name: 'first' });
    await expect(insertCase({ sourceFindingId: findingId, name: 'second' })).rejects.toThrow();
  });

  it('accepts two cases with the same owner_id and a null source_finding_id (AC-64)', async () => {
    await insertCase({ sourceFindingId: null, name: 'hand-written-1' });
    await insertCase({ sourceFindingId: null, name: 'hand-written-2' });
    // No assertion failure above means both inserts succeeded.
  });

  it('rejects a second queued/running batch for the same owner_id (AC-76)', async () => {
    const owner = randomUUID();
    await insertBatch({ status: 'queued', ownerId: owner });
    await expect(insertBatch({ status: 'running', ownerId: owner })).rejects.toThrow();
  });

  it('accepts a second batch for an owner whose only other batch is done, and two done batches (AC-76)', async () => {
    const owner = randomUUID();
    const done1 = await insertBatch({ status: 'done', ownerId: owner });
    const done2 = await insertBatch({ status: 'done', ownerId: owner });
    expect(done1.id).not.toBe(done2.id);
    // A third, live batch for the same owner is still fine once the others are terminal.
    const live = await insertBatch({ status: 'queued', ownerId: owner });
    expect(live.status).toBe('queued');
  });

  /**
   * Spec 0019's test-plan row (`specs/0019-evals.md:513`) calls for "the enum
   * rejection of an unknown expectation_kind" at this layer. That assertion
   * would be false: `expectationKind: text('expectation_kind', { enum: [...] })`
   * (`src/db/schema/eval.ts:56`) is a Drizzle-only, compile-time narrowing of
   * the `.values()` type — it emits a plain `text` column with no CHECK
   * constraint (`grep -rn CHECK server/src/db/migrations/*.sql` returns zero
   * hits across all 23 migrations). The real guard is the `EvalExpectationKind`
   * Zod schema in `@devdigest/shared`, already pinned by
   * `contracts-eval.test.ts`'s "AC-6: ... rejects 'maybe'" case.
   *
   * This test pins the actual contract instead: a write that reaches
   * `eval_cases` without going through that Zod schema — a raw SQL statement,
   * or a future repository method that skips validation — is persisted
   * unchecked. It bypasses Drizzle's inferred `.values()` type on purpose
   * (raw SQL, not `insertCase`) so the assertion is about the database, not
   * about TypeScript. If a later migration adds a CHECK constraint on this
   * column, this insert will start throwing and the test must flip to
   * `.rejects.toThrow()`.
   */
  it('does NOT reject an unrecognized expectation_kind at the database layer — the enum is enforced by Zod/TypeScript only, not a DB constraint', async () => {
    await pg.handle.db.execute(sql`
      insert into eval_cases
        (workspace_id, owner_kind, owner_id, name, expectation_kind, expected_file, expected_start_line, expected_end_line)
      values
        (${workspaceId}, 'agent', ${agentId}, 'raw-sql-unknown-kind', 'not_a_real_kind', 'src/a.ts', 1, 5)
    `);

    const [row] = await pg.handle.db
      .select()
      .from(t.evalCases)
      .where(eq(t.evalCases.name, 'raw-sql-unknown-kind'));

    // The database stored the invalid value verbatim — there is no CHECK
    // constraint on expectation_kind.
    expect(row!.expectationKind).toBe('not_a_real_kind');
  });

  it('rejects an eval_runs insert with an unknown batch_id', async () => {
    const evalCase = await insertCase();
    await expect(
      pg.handle.db.insert(t.evalRuns).values({
        caseId: evalCase.id,
        batchId: '00000000-0000-0000-0000-000000000099',
      }),
    ).rejects.toThrow();
  });
});
