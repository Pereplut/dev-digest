/**
 * POST /agents/:id/eval-runs, GET /agents/:id/eval-runs, GET /eval-runs/:batchId
 * (spec 0019). AC-31 through AC-35, AC-68.
 *
 * Written against the Docker lane (`pnpm exec vitest run .it.test`) — not run
 * by the implementer, per server/AGENTS.md's Docker-contention rule.
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
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const REVIEW_FIXTURE: Review = {
  verdict: 'comment',
  summary: 'ok',
  score: 100,
  findings: [],
};

/**
 * The header is load-bearing: `parseUnifiedDiff` keys files off `diff --git` /
 * `---` / `+++`, not off `@@`, so a bare hunk parses to `files: []` and every
 * case takes the "stored diff has no changed files" branch instead of the
 * model-call branch. Path and range must match `expectedFile` below.
 * See `server/INSIGHTS.md` (2026-10-07).
 */
const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,1 +1,2 @@',
  ' a',
  '+b',
].join('\n');

d('evals: run route (POST/GET /agents/:id/eval-runs, GET /eval-runs/:batchId) (Testcontainers pg)', () => {
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

  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) } },
    });
  }

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

  async function addCase(ownerId: string, overrides: Partial<typeof t.evalCases.$inferInsert> = {}) {
    const [row] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId,
        name: 'case',
        inputDiff: DIFF,
        expectationKind: 'must_find',
        expectedFile: 'src/a.ts',
        expectedStartLine: 1,
        expectedEndLine: 2,
        ...overrides,
      })
      .returning();
    return row!;
  }

  it('202 + batch_id; exactly one batch for that id, and one child row per case once terminal', async () => {
    const app = await appWith();
    const agent = await createAgent();
    await addCase(agent.id);

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.batch_id).toBeTruthy();

    // What is observable here is "exactly one batch, and it is the returned
    // one" — NOT its status. `queueBatch` fires the executor without awaiting
    // (that is what makes the route 202 rather than 200), and `MockLLMProvider`
    // answers instantly, so by the time this query runs the sweep has already
    // called `markRunning` and may have finished. Asserting `status === 'queued'`
    // passed by luck and failed on the suite's first real run with
    // `expected 'running' to be 'queued'`. The row's identity and ownership are
    // deterministic; its status at this instant is not.
    const batches = await pg.handle.db.select().from(t.evalRunBatches).where(eq(t.evalRunBatches.id, body.batch_id));
    expect(batches).toHaveLength(1);
    expect(batches[0]!.ownerId).toBe(agent.id);
    expect(batches[0]!.casesTotal).toBe(1);

    // The child-row count IS deterministic once the sweep is over: one case in,
    // exactly one `eval_runs` row out — which is the invariant AC-32 is really
    // about (the route creates one batch, and the sweep does not double-write).
    await waitForBatch(pg.handle.db, body.batch_id);
    const runs = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.batchId, body.batch_id));
    expect(runs).toHaveLength(1);
  });

  it('422 validation_error when the agent has zero eval cases; no batch created', async () => {
    const app = await appWith();
    const agent = await createAgent();

    const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');

    const batches = await pg.handle.db.select().from(t.evalRunBatches).where(eq(t.evalRunBatches.ownerId, agent.id));
    expect(batches).toHaveLength(0);
  });

  it('409 conflict on a second POST while a batch is queued/running; no second batch', async () => {
    const app = await appWith();
    const agent = await createAgent();
    await addCase(agent.id);

    const first = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(first.statusCode).toBe(202);

    const second = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('conflict');

    const batches = await pg.handle.db.select().from(t.evalRunBatches).where(eq(t.evalRunBatches.ownerId, agent.id));
    expect(batches).toHaveLength(1);
  });

  it('once a batch reaches done, a second POST is accepted', async () => {
    const app = await appWith();
    const agent = await createAgent();
    await addCase(agent.id);

    const first = (await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })).json();
    await waitForBatch(pg.handle.db, first.batch_id);

    const second = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(second.statusCode).toBe(202);
  });

  it('GET /agents/:id/eval-runs returns this agent\'s batches newest first; others absent', async () => {
    const agent = await createAgent();
    const other = await createAgent();
    const t0 = new Date('2026-01-01T00:00:00Z');
    const mkBatch = async (ownerId: string, agentId: string, ranAt: Date) =>
      (
        await pg.handle.db
          .insert(t.evalRunBatches)
          .values({ workspaceId, ownerKind: 'agent', ownerId, agentId, agentVersion: 1, casesTotal: 0, status: 'done', ranAt })
          .returning()
      )[0]!;

    const b1 = await mkBatch(agent.id, agent.id, t0);
    const b2 = await mkBatch(agent.id, agent.id, new Date('2026-01-02T00:00:00Z'));
    const b3 = await mkBatch(agent.id, agent.id, new Date('2026-01-03T00:00:00Z'));
    await mkBatch(other.id, other.id, new Date('2026-01-04T00:00:00Z')); // another agent

    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: `other-${randomUUID()}` }).returning();
    await pg.handle.db
      .insert(t.evalRunBatches)
      .values({
        workspaceId: otherWs!.id,
        ownerKind: 'agent',
        ownerId: agent.id,
        agentId: agent.id,
        agentVersion: 1,
        casesTotal: 0,
        status: 'done',
      }); // another workspace, same owner id — must still be absent

    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs` });
    expect(res.statusCode).toBe(200);
    const ids = res.json().map((b: { id: string }) => b.id);
    expect(ids).toEqual([b3.id, b2.id, b1.id]);
  });

  it('GET /eval-runs/:batchId returns the batch plus one entry per run with the 8 named fields', async () => {
    const app = await appWith();
    const agent = await createAgent();
    const c1 = await addCase(agent.id, { name: 'case-1' });
    const c2 = await addCase(agent.id, { name: 'case-2' });
    const [batch] = await pg.handle.db
      .insert(t.evalRunBatches)
      .values({ workspaceId, ownerKind: 'agent', ownerId: agent.id, agentId: agent.id, agentVersion: 1, casesTotal: 2, status: 'done' })
      .returning();
    await pg.handle.db.insert(t.evalRuns).values([
      { caseId: c1.id, batchId: batch!.id, pass: true, recall: 1, precision: 1, citationAccuracy: 1, durationMs: 10, costUsd: '0.000001' },
      { caseId: c2.id, batchId: batch!.id, pass: false, recall: 0, precision: 1, citationAccuracy: 1, durationMs: 20, costUsd: '0.000002' },
    ]);

    const res = await app.inject({ method: 'GET', url: `/eval-runs/${batch!.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.batch.id).toBe(batch!.id);
    expect(body.runs).toHaveLength(2);
    for (const run of body.runs) {
      expect(run).toEqual(
        expect.objectContaining({
          case_id: expect.any(String),
          case_name: expect.any(String),
          pass: expect.any(Boolean),
          recall: expect.any(Number),
          precision: expect.any(Number),
          citation_accuracy: expect.any(Number),
          duration_ms: expect.any(Number),
          cost_usd: expect.any(Number),
        }),
      );
    }
  });
});

const TERMINAL = new Set(['done', 'failed', 'cancelled']);
async function waitForBatch(
  db: PgFixture['handle']['db'],
  batchId: string,
  timeoutMs = 10_000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    const [row] = await db.select().from(t.evalRunBatches).where(eq(t.evalRunBatches.id, batchId));
    if (row && TERMINAL.has(row.status)) return;
    if (Date.now() - start > timeoutMs) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}
