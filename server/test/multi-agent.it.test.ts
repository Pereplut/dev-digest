/**
 * Multi-agent review over a real Postgres (spec 0021: AC-1, 3, 4, 11-14, 23).
 * USER-RUN lane: `cd server && pnpm exec vitest run .it.test` (Docker).
 * Written by an implementer that may not run it — treat as unverified until it has.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = ['diff --git a/src/config.ts b/src/config.ts', '--- a/src/config.ts', '+++ b/src/config.ts',
  '@@ -10,3 +10,4 @@', '   port: 3000,', '+  stripeKey: "sk_live_xxx",', '   redisUrl: x,'].join('\n');

const REVIEW: Review = {
  verdict: 'request_changes', summary: 'Secret.', score: 42,
  findings: [{
    id: 'f1', severity: 'CRITICAL', category: 'security', title: 'Hardcoded key', file: 'src/config.ts',
    start_line: 11, end_line: 11, rationale: 'r', suggestion: 'env', confidence: 0.9, kind: 'finding',
  }],
};

let seq = 0;
d('multi-agent review (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => pg?.stop());

  // buildApp does not reap `running` rows under nodeEnv=test, so seeding them freely is safe.
  const app = () =>
    buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW }) },
      },
    });

  async function newPr() {
    const db = pg.handle.db;
    const name = `multi-${seq++}`;
    const [repo] = await db.insert(t.repos).values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` }).returning();
    const [pr] = await db.insert(t.pullRequests).values({
      workspaceId, repoId: repo!.id, number: 100 + seq, title: 'PR', author: 'a', branch: 'b', base: 'main',
      headSha: 'abc', additions: 1, deletions: 0, filesCount: 1, status: 'needs_review',
    }).returning();
    await db.insert(t.prFiles).values({ prId: pr!.id, path: 'src/config.ts', additions: 1, deletions: 0, patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,' });
    return pr!;
  }

  async function newAgent(a: ReturnType<typeof app> extends Promise<infer A> ? A : never, name: string) {
    const res = await a.inject({ method: 'POST', url: '/agents', payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 's' } });
    return res.json() as { id: string };
  }

  it('AC-13: with no run anywhere, latest answers 200 { run: null } (runs first in this file)', async () => {
    const a = await app();
    const res = await a.inject({ method: 'GET', url: '/multi-agent/latest' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ run: null });
    await a.close();
  });

  it('AC-11: multi_run_id is a nullable uuid FK with ON DELETE SET NULL', async () => {
    const rows = await pg.handle.db.execute(sql`
      select c.is_nullable, c.data_type, rc.delete_rule
      from information_schema.columns c
      left join information_schema.key_column_usage k
        on k.table_name = c.table_name and k.column_name = c.column_name
      left join information_schema.referential_constraints rc on rc.constraint_name = k.constraint_name
      where c.table_name = 'agent_runs' and c.column_name = 'multi_run_id'`);
    const row = (rows as unknown as { is_nullable: string; data_type: string; delete_rule: string }[])[0]!;
    expect(row).toMatchObject({ is_nullable: 'YES', data_type: 'uuid', delete_rule: 'SET NULL' });
  });

  it('AC-1/3/12/14: a 2-agent request stamps both children and GET returns the columns', async () => {
    const a = await app();
    const pr = await newPr();
    const [a1, a2] = [await newAgent(a, 'One'), await newAgent(a, 'Two')];
    const res = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agent_ids: [a1.id, a2.id] } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.multi_run_id).toEqual(expect.any(String));
    expect(body.runs).toHaveLength(2);
    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });
    expect(runs.every((r) => r.multiRunId === body.multi_run_id)).toBe(true);

    const got = await a.inject({ method: 'GET', url: `/multi-agent/${body.multi_run_id}` });
    expect(got.statusCode).toBe(200);
    const run = got.json();
    expect(run).toMatchObject({ pr_id: pr.id, pr_number: pr.number, agent_count: 2 });
    expect(run.columns).toHaveLength(2);
    expect(run.columns[0].findings[0]).toHaveProperty('confidence');
    expect(typeof run.columns[0].cost_usd === 'number' || run.columns[0].cost_usd === null).toBe(true);
    expect(run.conflicts.length).toBeGreaterThan(0);

    // AC-14: a deleted agent keeps its column with agent_id null.
    await a.inject({ method: 'DELETE', url: `/agents/${a1.id}` });
    const after = (await a.inject({ method: 'GET', url: `/multi-agent/${body.multi_run_id}` })).json();
    expect(after.columns.some((c: { agent_id: string | null }) => c.agent_id === null)).toBe(true);
    await a.close();
  });

  it('AC-4: a single agent leaves multi_run_id NULL and creates no parent', async () => {
    const a = await app();
    const pr = await newPr();
    const ag = await newAgent(a, 'Solo');
    const res = await a.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agent_ids: [ag.id] } });
    expect(res.json().multi_run_id).toBeNull();
    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    expect(runs[0]!.multiRunId).toBeNull();
    await a.close();
  });

  it('AC-12: unknown and foreign-workspace ids are 404', async () => {
    const a = await app();
    expect((await a.inject({ method: 'GET', url: '/multi-agent/00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404);
    const [other] = await pg.handle.db.insert(t.workspaces).values({ name: `other-${seq++}` }).returning();
    const [repo] = await pg.handle.db.insert(t.repos).values({ workspaceId: other!.id, owner: 'x', name: `r${seq}`, fullName: `x/r${seq}` }).returning();
    const [pr] = await pg.handle.db.insert(t.pullRequests).values({
      workspaceId: other!.id, repoId: repo!.id, number: 1, title: 'F', author: 'a', branch: 'b', base: 'main',
      headSha: 'z', additions: 0, deletions: 0, filesCount: 0, status: 'needs_review',
    }).returning();
    const [foreign] = await pg.handle.db.insert(t.multiAgentRuns).values({ workspaceId: other!.id, prId: pr!.id }).returning();
    expect((await a.inject({ method: 'GET', url: `/multi-agent/${foreign!.id}` })).statusCode).toBe(404);
    expect((await a.inject({ method: 'GET', url: `/multi-agent/latest?pr_id=${pr!.id}` })).statusCode).toBe(404);
    await a.close();
  });

  it('AC-13: latest returns the newer run for a PR and the newest across PRs; a cancelled column surfaces', async () => {
    const a = await app();
    const db = pg.handle.db;
    const pr1 = await newPr();
    const pr2 = await newPr();
    const [older] = await db.insert(t.multiAgentRuns).values({ workspaceId, prId: pr1.id, ranAt: new Date('2030-01-01') }).returning();
    const [newer] = await db.insert(t.multiAgentRuns).values({ workspaceId, prId: pr1.id, ranAt: new Date('2030-01-02') }).returning();
    const [newest] = await db.insert(t.multiAgentRuns).values({ workspaceId, prId: pr2.id, ranAt: new Date('2030-01-03') }).returning();
    expect((await a.inject({ method: 'GET', url: `/multi-agent/latest?pr_id=${pr1.id}` })).json().run.id).toBe(newer!.id);
    expect((await a.inject({ method: 'GET', url: '/multi-agent/latest' })).json().run.id).toBe(newest!.id);
    expect(older!.id).not.toBe(newer!.id);

    await db.insert(t.agentRuns).values({ workspaceId, prId: pr2.id, multiRunId: newest!.id, status: 'cancelled', source: 'local' });
    const cols = (await a.inject({ method: 'GET', url: `/multi-agent/${newest!.id}` })).json().columns;
    expect(cols[0].status).toBe('cancelled');
    await a.close();
  });

  it('AC-23: estimates average done runs only; no done run -> null', async () => {
    const a = await app();
    const db = pg.handle.db;
    const pr = await newPr();
    const done = await newAgent(a, 'HasHistory');
    const failedOnly = await newAgent(a, 'FailedOnly');
    await db.insert(t.agentRuns).values([
      { workspaceId, prId: pr.id, agentId: done.id, status: 'done', durationMs: 1000, costUsd: '0.01', source: 'local' },
      { workspaceId, prId: pr.id, agentId: done.id, status: 'done', durationMs: 3000, costUsd: '0.03', source: 'local' },
      { workspaceId, prId: pr.id, agentId: done.id, status: 'failed', durationMs: 99999, costUsd: '9', source: 'local' },
      { workspaceId, prId: pr.id, agentId: failedOnly.id, status: 'failed', durationMs: 5, source: 'local' },
      { workspaceId, prId: pr.id, agentId: failedOnly.id, status: 'running', source: 'local' },
    ]);
    const list = (await a.inject({ method: 'GET', url: '/agents' })).json() as { id: string; est_duration_ms: number | null; est_cost_usd: number | null }[];
    const withHistory = list.find((x) => x.id === done.id)!;
    expect(withHistory.est_duration_ms).toBe(2000);
    expect(withHistory.est_cost_usd).toBeCloseTo(0.02, 6);
    expect(typeof withHistory.est_cost_usd).toBe('number');
    const none = list.find((x) => x.id === failedOnly.id)!;
    expect(none.est_duration_ms).toBeNull();
    expect(none.est_cost_usd).toBeNull();
    await a.close();
  });
});
