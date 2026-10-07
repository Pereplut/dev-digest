/**
 * EvalService.reapOrphanedBatches() (spec 0019). AC-72.
 *
 * Called DIRECTLY (not via a boot test): the reap sits inside `buildApp`'s
 * `if (config.nodeEnv !== 'test')` block (`app.ts:101`), which never runs
 * under test — a test boot would reap the developer's database
 * (server/INSIGHTS.md, 2026-09-27). AC-75 (the wiring) is read-verified only.
 *
 * Written against the Docker lane (`pnpm exec vitest run .it.test`) — not run
 * by the implementer, per server/AGENTS.md's Docker-contention rule.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { loadConfig } from '../src/platform/config.js';
import { Container } from '../src/platform/container.js';
import { EvalService } from '../src/modules/evals/service.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('EvalService.reapOrphanedBatches (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let agentId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [agent] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId)).limit(1);
    agentId = agent!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function insertBatch(status: 'queued' | 'running' | 'done') {
    const [row] = await pg.handle.db
      .insert(t.evalRunBatches)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: randomUUID(),
        agentId,
        agentVersion: 1,
        casesTotal: 1,
        status,
      })
      .returning();
    return row!;
  }

  it('fails every queued/running batch with a non-empty error; leaves a done batch untouched', async () => {
    const running = await insertBatch('running');
    const queued = await insertBatch('queued');
    const done = await insertBatch('done');

    // A real Container over the test's own db handle — no HTTP, no buildApp
    // boot (which would skip the reap entirely under NODE_ENV=test, see the
    // file header).
    const container = new Container(config(), pg.handle.db);
    const count = await new EvalService(container).reapOrphanedBatches();
    expect(count).toBe(2);

    const [afterRunning] = await pg.handle.db.select().from(t.evalRunBatches).where(eq(t.evalRunBatches.id, running.id));
    const [afterQueued] = await pg.handle.db.select().from(t.evalRunBatches).where(eq(t.evalRunBatches.id, queued.id));
    const [afterDone] = await pg.handle.db.select().from(t.evalRunBatches).where(eq(t.evalRunBatches.id, done.id));

    expect(afterRunning!.status).toBe('failed');
    expect(afterRunning!.error).toBeTruthy();
    expect(afterQueued!.status).toBe('failed');
    expect(afterQueued!.error).toBeTruthy();
    expect(afterDone!.status).toBe('done');
    expect(afterDone!.error).toBeNull();
  });

  it('a second call reaps nothing further (idempotent once nothing is live)', async () => {
    const container = new Container(config(), pg.handle.db);
    const service = new EvalService(container);
    await insertBatch('running');
    await service.reapOrphanedBatches();
    const second = await service.reapOrphanedBatches();
    expect(second).toBe(0);
  });
});
