/**
 * `eval_run_batches.metrics_version` against the MIGRATED database (spec
 * 0020 S3 – S6, R1 – R4). Written against the Docker lane
 * (`pnpm exec vitest run .it.test`) — not run by the implementer, per
 * server/AGENTS.md's Docker-contention rule.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { EVAL_METRICS_VERSION } from '../src/modules/evals/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,1 +1,2 @@',
  ' a',
  '+b',
].join('\n');

d('eval_run_batches.metrics_version — migrated column (spec 0020, Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function createAgent() {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: `Agent-${randomUUID()}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'review',
      })
      .returning();
    return agent!;
  }

  it('AC-1: metrics_version is NOT NULL at the database — an explicit null is rejected', async () => {
    const agent = await createAgent();
    await expect(
      pg.handle.db.insert(t.evalRunBatches).values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agent.id,
        agentId: agent.id,
        agentVersion: 1,
        casesTotal: 1,
        metricsVersion: null as unknown as number,
      }),
    ).rejects.toThrow();
  });

  it('AC-1/AC-3: an insert that omits metrics_version takes the CURRENT formula default', async () => {
    const agent = await createAgent();
    const [row] = await pg.handle.db
      .insert(t.evalRunBatches)
      .values({ workspaceId, ownerKind: 'agent', ownerId: agent.id, agentId: agent.id, agentVersion: 1, casesTotal: 1 })
      .returning();
    expect(row!.metricsVersion).toBe(EVAL_METRICS_VERSION);
  });

  it('AC-2: a row explicitly stamped 1 (simulating one written before this migration) round-trips as 1, never silently restamped', async () => {
    const agent = await createAgent();
    const [row] = await pg.handle.db
      .insert(t.evalRunBatches)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agent.id,
        agentId: agent.id,
        agentVersion: 1,
        casesTotal: 1,
        metricsVersion: 1,
      })
      .returning();
    const [reread] = await pg.handle.db
      .select()
      .from(t.evalRunBatches)
      .where(eq(t.evalRunBatches.id, row!.id));
    expect(reread!.metricsVersion).toBe(1);
  });

  it('POST /agents/:id/eval-runs stamps the new batch with EVAL_METRICS_VERSION end to end', async () => {
    const agent = await createAgent();
    await pg.handle.db.insert(t.evalCases).values({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agent.id,
      name: 'case',
      inputDiff: DIFF,
      expectationKind: 'must_find',
      expectedFile: 'src/a.ts',
      expectedStartLine: 1,
      expectedEndLine: 2,
    });
    const app = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        llm: {
          openai: new MockLLMProvider('openai', {
            structured: { verdict: 'comment', summary: 'ok', score: 100, findings: [] },
          }),
        },
      },
    });
    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(202);
    const { batch_id } = res.json();
    const [row] = await pg.handle.db
      .select()
      .from(t.evalRunBatches)
      .where(eq(t.evalRunBatches.id, batch_id));
    expect(row!.metricsVersion).toBe(EVAL_METRICS_VERSION);
  });
});
