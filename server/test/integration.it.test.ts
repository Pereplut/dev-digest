import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { and, eq, inArray } from 'drizzle-orm';
import type { PrMeta } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn(
    '[integration] Docker not available — skipping Testcontainers integration tests.',
  );
}

d('Testcontainers: pg + pgvector', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('migrations applied: every table exists', async () => {
    const rows = await pg.handle.sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM information_schema.tables
      WHERE table_schema = 'public'`;
    // 35 domain tables + drizzle migration bookkeeping
    expect(rows[0]!.count).toBeGreaterThanOrEqual(35);
  });

  it('pgvector extension is enabled', async () => {
    const rows = await pg.handle.sql<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    expect(rows).toHaveLength(1);
  });

  it('vector insert + similarity query round-trips', async () => {
    const { db } = pg.handle;
    const { workspaceId } = await seed(db);
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'v', name: 'vec', fullName: 'v/vec' })
      .returning();
    const vec = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
    await db.insert(t.codeChunks).values({
      workspaceId,
      repoId: repo!.id,
      path: 'a.ts',
      content: 'hello',
      embedding: vec,
      source: 'code',
    });
    // cosine distance query against the same vector → distance ~0
    const literal = `[${vec.join(',')}]`;
    const rows = await pg.handle.sql<{ dist: number }[]>`
      SELECT embedding <=> ${literal}::vector AS dist
      FROM code_chunks WHERE repo_id = ${repo!.id}`;
    expect(rows[0]!.dist).toBeLessThan(0.0001);
  });

  it('seed is idempotent (re-run does not duplicate workspace)', async () => {
    await seed(pg.handle.db);
    await seed(pg.handle.db);
    const ws = await pg.handle.db.select().from(t.workspaces);
    expect(ws.filter((w) => w.name === 'default')).toHaveLength(1);
  });
});

d('Testcontainers: DB-backed routes via app.inject', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('POST /repos persists + enqueues a clone (mock git) and GET /repos lists it', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const git = new MockGitClient();
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git, github: new MockGitHubClient() },
    });

    const create = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/widgets' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().full_name).toBe('acme/widgets');

    await app.container.jobs.onIdle();
    expect(git.cloned.some((c) => c.repo.name === 'widgets')).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/repos' });
    expect(list.json().some((r: { full_name: string }) => r.full_name === 'acme/widgets')).toBe(
      true,
    );
    await app.close();
  });

  it('GET /repos/:id/pulls imports PRs (mock GitHub) idempotently', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const repos = await app.inject({ method: 'GET', url: '/repos' });
    const repoId = repos.json()[0]!.id;

    const first = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(first.statusCode).toBe(200);
    expect(first.json().length).toBeGreaterThan(0);
    // import again → still idempotent (unique repo_id+number)
    const second = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(second.json().length).toBe(first.json().length);
    await app.close();
  });

  it('GET /repos/:id/pulls reports the latest review round cost per PR', async () => {
    const { db } = pg.handle;
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const [repo] = await db.select().from(t.repos).where(eq(t.repos.fullName, 'acme/payments-api'));
    const [pr] = await db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repo!.id), eq(t.pullRequests.number, 482)));
    const agents = await db.select().from(t.agents).where(eq(t.agents.workspaceId, repo!.workspaceId));
    const agentId = (name: string) => agents.find((a) => a.name === name)!.id;
    const list = async () =>
      (await app.inject({ method: 'GET', url: `/repos/${repo!.id}/pulls` })).json() as PrMeta[];
    const pr482 = async () => (await list()).find((p) => p.number === 482)!;

    // Seeded round: General 0.0149 + Security 0.0011.
    let row = await pr482();
    expect(row.cost_usd).toBeCloseTo(0.016, 10);
    expect(row.cost_complete).toBe(true);

    const base = {
      workspaceId: repo!.workspaceId,
      prId: pr!.id,
      provider: 'openrouter',
      model: 'm',
      source: 'local' as const,
    };
    const at = (secondsFromNow: number) => new Date(Date.now() + secondsFromNow * 1000);
    const inserted = await db
      .insert(t.agentRuns)
      .values([
        // newer done Security run replaces its 0.0011
        { ...base, agentId: agentId('Security Reviewer'), status: 'done', costUsd: 0.002, ranAt: at(60) },
        // newer FAILED General run is ignored: its 0.0149 still counts
        { ...base, agentId: agentId('General Reviewer'), status: 'failed', costUsd: null, ranAt: at(120) },
      ])
      .returning({ id: t.agentRuns.id });
    row = await pr482();
    expect(row.cost_usd).toBeCloseTo(0.0169, 10);
    expect(row.cost_complete).toBe(true);

    // an unpriced done run in the round makes the total partial
    inserted.push(
      ...(await db
        .insert(t.agentRuns)
        .values({ ...base, agentId: agentId('Performance Reviewer'), status: 'done', costUsd: null, ranAt: at(180) })
        .returning({ id: t.agentRuns.id })),
    );
    row = await pr482();
    expect(row.cost_usd).toBeCloseTo(0.0169, 10);
    expect(row.cost_complete).toBe(false);

    // a PR with no runs has no cost
    const [bare] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: repo!.workspaceId,
        repoId: repo!.id,
        number: 9001,
        title: 'No runs yet',
        author: 'someone',
        branch: 'feat/x',
        base: 'main',
        headSha: 'ffff',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'open',
      })
      .returning();
    const bareRow = (await list()).find((p) => p.number === 9001)!;
    expect(bareRow.cost_usd).toBeNull();
    expect(bareRow.cost_complete).toBeNull();

    await db.delete(t.agentRuns).where(inArray(t.agentRuns.id, inserted.map((r) => r.id)));
    await db.delete(t.pullRequests).where(eq(t.pullRequests.id, bare!.id));
    await app.close();
  });

  it('POST /repos/:id/poll syncs PR list and does NOT trigger a review', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const repoId = (await app.inject({ method: 'GET', url: '/repos' })).json()[0]!.id;
    const poll = await app.inject({ method: 'POST', url: `/repos/${repoId}/poll` });
    expect(poll.json().reviewTriggered).toBe(false);
    expect(poll.json().synced).toBeGreaterThan(0);
    await app.close();
  });
});
