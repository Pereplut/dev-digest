/**
 * POST /runs/:id/cancel — one of the three defining user actions, and the one
 * that had ZERO tests at any level (plan item H1; `grep cancel server/test`
 * previously matched only a list of terminal statuses in helpers/runs.ts).
 *
 * Cancellation is the flow with real concurrency, which is exactly why these
 * tests do NOT race a live review. `cancelRunIfRunning` updates
 * `status -> 'cancelled'` only `WHERE id = ? AND status = 'running'`
 * (repository/run.repo.ts:115), so the interesting behaviour is fully
 * observable from a seeded row:
 *   - an ORPHANED running run (its process died on a restart) still cancels,
 *     which is the case the service was written for;
 *   - a finished run is left alone, so a late cancel cannot rewrite history;
 *   - the cancelled run disappears from the active-runs endpoint the UI polls.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;

d('POST /runs/:id/cancel (Testcontainers pg)', () => {
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

  /** A repo + PR + one agent_runs row in `status`. No agent, no LLM, no clone. */
  async function setupRun(status: string) {
    const db = pg.handle.db;
    const name = `cancel-${seq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'deadbeef',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'open',
      })
      .returning();
    const [run] = await db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr!.id, provider: 'openai', model: 'gpt-4.1', status })
      .returning();
    return { pr: pr!, run: run! };
  }

  const statusOf = async (runId: string) => {
    const [row] = await pg.handle.db
      .select({ status: t.agentRuns.status })
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, runId));
    return row!.status;
  };

  it('cancels an orphaned running run and drops it from the active list', async () => {
    // ORDER MATTERS. buildApp reaps every 'running' agent_runs row on boot
    // (app.ts:81 -> reapStaleRunningRuns, which is global: no workspace scope,
    // no age filter). A row seeded BEFORE the app is built is already 'failed'
    // by the time the request runs, and the symptom — an empty active list —
    // reads like a broken query rather than a destroyed fixture.
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const { pr, run } = await setupRun('running');

    const before = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs/active` })
    ).json() as { run_id: string }[];
    expect(before.map((r) => r.run_id)).toContain(run.id);

    const res = await app.inject({ method: 'POST', url: `/runs/${run.id}/cancel` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    expect(await statusOf(run.id)).toBe('cancelled');

    const after = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs/active` })
    ).json() as { run_id: string }[];
    expect(after.map((r) => r.run_id)).not.toContain(run.id);
  });

  it('leaves an already-finished run untouched', async () => {
    const { run } = await setupRun('done');
    const app = await buildApp({ config: config(), db: pg.handle.db });

    const res = await app.inject({ method: 'POST', url: `/runs/${run.id}/cancel` });
    expect(res.statusCode).toBe(200);

    // A late cancel must not rewrite a completed run's outcome.
    expect(await statusOf(run.id)).toBe('done');
  });

  it('answers ok for an unknown run id rather than 404', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });

    const res = await app.inject({ method: 'POST', url: `/runs/${randomUUID()}/cancel` });

    // Pinning CURRENT behaviour, not endorsing it: cancelRun signals the bus
    // and issues a conditional update, neither of which distinguishes "already
    // finished" from "never existed", so the route cannot tell them apart.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('rejects a non-uuid run id at the edge', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });

    const res = await app.inject({ method: 'POST', url: '/runs/not-a-uuid/cancel' });

    expect(res.statusCode).toBe(422);
  });
});
