/**
 * Abandoned jobs are reaped on boot (plan item D12).
 *
 * The `jobs` table is WRITE-ONLY: JobRunner inserts a row and updates its
 * status, and nothing in the codebase ever SELECTs it — no route, no client
 * call, no test before this one. So a process that died mid-queue left rows
 * sitting at 'queued' forever, describing work that would never happen, and
 * `jobs_status_idx` indexed a column no one read.
 *
 * This does not RECOVER the work (that needs a durable claim, e.g.
 * FOR UPDATE SKIP LOCKED). It makes the table honest.
 *
 * Note the fixture order: rows are seeded BEFORE buildApp, because buildApp is
 * what runs the reaper. That is the exact inverse of runs-cancel.it.test.ts,
 * where the same boot-time reaping destroys a fixture if you seed first.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('abandoned jobs are reaped on boot (Testcontainers pg)', () => {
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

  const insertJob = async (status: 'queued' | 'running' | 'done' | 'failed') => {
    const [row] = await pg.handle.db
      .insert(t.jobs)
      .values({ workspaceId, kind: 'clone', payload: {}, status })
      .returning();
    return row!;
  };

  const rowById = async (id: string) => {
    const [row] = await pg.handle.db.select().from(t.jobs).where(eq(t.jobs.id, id));
    return row!;
  };

  it('fails queued and running jobs, leaves settled ones alone, and says why', async () => {
    const queued = await insertJob('queued');
    const running = await insertJob('running');
    const done = await insertJob('done');
    const alreadyFailed = await insertJob('failed');

    // buildApp is what reaps — seed first, then boot.
    await buildApp({ config: config(), db: pg.handle.db });

    const reapedQueued = await rowById(queued.id);
    expect(reapedQueued.status).toBe('failed');
    expect(reapedQueued.error).toMatch(/Abandoned/);
    expect(reapedQueued.finishedAt).not.toBeNull();

    expect((await rowById(running.id)).status).toBe('failed');

    // A settled job keeps its outcome and its (absent) error.
    const untouched = await rowById(done.id);
    expect(untouched.status).toBe('done');
    expect(untouched.error).toBeNull();

    expect((await rowById(alreadyFailed.id)).status).toBe('failed');
  });

  it('is idempotent — a second boot reaps nothing new', async () => {
    const queued = await insertJob('queued');

    await buildApp({ config: config(), db: pg.handle.db });
    const first = await rowById(queued.id);
    expect(first.status).toBe('failed');

    await buildApp({ config: config(), db: pg.handle.db });
    const second = await rowById(queued.id);
    // Still failed, and the first boot's timestamp was not rewritten.
    expect(second.status).toBe('failed');
    expect(second.finishedAt?.getTime()).toBe(first.finishedAt?.getTime());
  });
});
