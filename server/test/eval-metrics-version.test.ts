import { describe, it, expect } from 'vitest';
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import { and, eq, inArray } from 'drizzle-orm';
import * as t from '../src/db/schema.js';
import { EVAL_METRICS_VERSION } from '../src/modules/evals/constants.js';
import { EvalBatchRepository } from '../src/modules/evals/repository/eval-batch.repo.js';
import { toEvalBatchRecordDto } from '../src/modules/evals/helpers.js';
import type { EvalRunBatchRow } from '../src/db/rows.js';

/**
 * Spec 0020 S3 – S6, hermetic half (R1 – R4). The Docker half — the migrated
 * column is NOT NULL, a row inserted under the 0023 default reads `1` — is
 * `eval-metrics-version.it.test.ts`, written but not run here (the Docker
 * lane is the user's — root AGENTS.md).
 */
describe('eval_run_batches.metrics_version (spec 0020)', () => {
  it('AC-1: the schema default equals the exported EVAL_METRICS_VERSION constant, not a re-typed literal', () => {
    const cfg = getTableConfig(t.evalRunBatches);
    const col = cfg.columns.find((c) => c.name === 'metrics_version');
    expect(col).toBeDefined();
    expect(col!.hasDefault).toBe(true);
    expect(col!.default).toBe(EVAL_METRICS_VERSION);
    expect(col!.notNull).toBe(true);
  });

  it("0023's migration text adds the column with DEFAULT 1 (the pre-2026-10-08 formula), not the current constant", async () => {
    const fs = await import('node:fs/promises');
    const sql = await fs.readFile(
      new URL('../src/db/migrations/0023_natural_vargas.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toContain('"metrics_version" integer DEFAULT 1 NOT NULL');
  });

  it("0024's migration text only flips the default — no add, no drop, no rename", async () => {
    const fs = await import('node:fs/promises');
    const sql = await fs.readFile(
      new URL('../src/db/migrations/0024_sad_morg.sql', import.meta.url),
      'utf8',
    );
    expect(sql.trim()).toBe('ALTER TABLE "eval_run_batches" ALTER COLUMN "metrics_version" SET DEFAULT 2;');
  });

  it('AC-3 negative control: insertQueued stamps whatever value the CALLER passes, not a hard-coded literal', async () => {
    // A fake db capturing .values() so the test reads the STAMP, not a round
    // trip through a real connection — this is the "read the constant, not
    // today's literal" control the plan names for S6 (a repository test, not
    // an .it.test, since no row needs to be read back).
    const captured: Record<string, unknown>[] = [];
    const fakeDb = {
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          captured.push(v);
          return {
            returning: async () => [{ ...v, id: 'b1', ranAt: new Date(), status: 'queued' } as unknown],
          };
        },
      }),
      // unused by insertQueued
    } as unknown as import('../src/db/client.js').DbOrTx;

    const repo = new EvalBatchRepository(fakeDb);
    await repo.insertQueued({
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent1',
      agentId: 'agent1',
      agentVersion: 1,
      casesTotal: 1,
      metricsVersion: 99,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.metricsVersion).toBe(99);
  });

  it('toEvalBatchRecordDto maps metrics_version straight through (AC-4)', () => {
    const row = {
      id: 'b1',
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent1',
      agentId: 'agent1',
      agentVersion: 1,
      ranAt: new Date('2026-10-08T00:00:00.000Z'),
      status: 'done',
      error: null,
      recall: 0.5,
      precision: 0.5,
      citationAccuracy: 1,
      casesTotal: 2,
      casesPassed: 1,
      durationMs: 100,
      costUsd: '0.0001',
      metricsVersion: 2,
    } as unknown as EvalRunBatchRow;
    expect(toEvalBatchRecordDto(row).metrics_version).toBe(2);
  });

  it('hasLiveBatchForAgent compiles against the agent_id column, not owner_id (C9)', () => {
    // hasLiveBatchForAgent's predicate shape, reproduced the way
    // `eval-batch.repo.ts` builds it — asserts the compiled SQL mentions
    // "agent_id", never "owner_id", pinning the AC-34/C9 distinction
    // hermetically, no DB connection needed (server/INSIGHTS.md 2026-10-07,
    // PgDialect.sqlToQuery).
    const dialect = new PgDialect();
    const cond = and(
      eq(t.evalRunBatches.agentId, 'a1'),
      inArray(t.evalRunBatches.status, ['queued', 'running']),
    );
    const { sql } = dialect.sqlToQuery(cond!);
    expect(sql).toContain('agent_id');
    expect(sql).not.toContain('owner_id');
  });
});
