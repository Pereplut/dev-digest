/**
 * GET /agents/:id/eval-dashboard (spec 0020 AC-11, AC-12, AC-15, AC-18,
 * AC-19). Written against the Docker lane (`pnpm exec vitest run .it.test`)
 * — not run by the implementer, per server/AGENTS.md's Docker-contention
 * rule.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { EvalDashboard } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('GET /agents/:id/eval-dashboard (spec 0020, Testcontainers pg)', () => {
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
    return buildApp({ config: config(), db: pg.handle.db });
  }

  async function createAgent(ws = workspaceId) {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId: ws, name: `Agent-${randomUUID()}`, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'review' })
      .returning();
    return agent!;
  }

  async function mkBatch(
    agentId: string,
    ranAt: Date,
    overrides: Partial<typeof t.evalRunBatches.$inferInsert> = {},
  ) {
    const [row] = await pg.handle.db
      .insert(t.evalRunBatches)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agentId,
        agentId,
        agentVersion: 1,
        casesTotal: 4,
        casesPassed: 2,
        status: 'done',
        ranAt,
        recall: 0.5,
        precision: 0.5,
        citationAccuracy: 0.9,
        ...overrides,
      })
      .returning();
    return row!;
  }

  it('AC-11/AC-12/AC-15: four batches for one agent (two done, one cancelled, one failed) — current from newest done, recent_runs = all four, newest first, no foreign rows', async () => {
    const agent = await createAgent();
    const other = await createAgent();
    const t0 = new Date('2026-01-01T00:00:00Z');
    const b1 = await mkBatch(agent.id, t0, { recall: 0.3, precision: 0.3, citationAccuracy: 0.3 });
    const b2 = await mkBatch(agent.id, new Date('2026-01-02T00:00:00Z'), {
      recall: 0.8,
      precision: 0.7,
      citationAccuracy: 0.9,
      casesPassed: 3,
      casesTotal: 5,
    });
    const b3 = await mkBatch(agent.id, new Date('2026-01-03T00:00:00Z'), { status: 'cancelled' });
    const b4 = await mkBatch(agent.id, new Date('2026-01-04T00:00:00Z'), { status: 'failed' });
    await mkBatch(other.id, new Date('2026-01-05T00:00:00Z')); // another agent

    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${randomUUID()}` })
      .returning();
    await pg.handle.db.insert(t.evalRunBatches).values({
      workspaceId: otherWs!.id,
      ownerKind: 'agent',
      ownerId: agent.id,
      agentId: agent.id,
      agentVersion: 1,
      casesTotal: 1,
      status: 'done',
    }); // same owner id, different workspace — must still be absent

    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-dashboard` });
    expect(res.statusCode).toBe(200);
    const body = EvalDashboard.parse(res.json());
    expect(body.owner_kind).toBe('agent');
    expect(body.owner_id).toBe(agent.id);
    expect(body.current.recall).toBeCloseTo(0.8);
    expect(body.current.traces_passed).toBe(3);
    expect(body.current.traces_total).toBe(5);
    expect(body.recent_runs.map((r) => r.id)).toEqual([b4.id, b3.id, b2.id, b1.id]);
    await app.close();
  });

  it('AC-18: no done batch at all — 200 with nulls throughout, trend empty, cases_total = the agent\'s case count', async () => {
    const agent = await createAgent();
    await pg.handle.db.insert(t.evalCases).values([
      {
        workspaceId,
        ownerKind: 'agent',
        ownerId: agent.id,
        name: 'c1',
        expectationKind: 'must_find',
        expectedFile: 'a.ts',
        expectedStartLine: 1,
        expectedEndLine: 1,
      },
      {
        workspaceId,
        ownerKind: 'agent',
        ownerId: agent.id,
        name: 'c2',
        expectationKind: 'must_find',
        expectedFile: 'b.ts',
        expectedStartLine: 1,
        expectedEndLine: 1,
      },
    ]);

    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-dashboard` });
    expect(res.statusCode).toBe(200);
    const body = EvalDashboard.parse(res.json());
    expect(body.current).toEqual({
      recall: null,
      precision: null,
      citation_accuracy: null,
      traces_passed: 0,
      traces_total: 0,
      cost_usd: null,
    });
    expect(body.trend).toEqual([]);
    expect(body.alert).toBeNull();
    expect(body.cases_total).toBe(2);
    await app.close();
  });

  it('AC-19: an unknown agent id and a foreign-workspace agent id each 404', async () => {
    const app = await appWith();
    const ghost = '00000000-0000-0000-0000-000000000000';
    expect((await app.inject({ method: 'GET', url: `/agents/${ghost}/eval-dashboard` })).statusCode).toBe(404);

    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other2-${randomUUID()}` })
      .returning();
    const foreignAgent = await createAgent(otherWs!.id);
    const res = await app.inject({ method: 'GET', url: `/agents/${foreignAgent.id}/eval-dashboard` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    await app.close();
  });
});
