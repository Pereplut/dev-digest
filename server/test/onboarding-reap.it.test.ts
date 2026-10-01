/**
 * Boot reap for onboarding generations (AC-18). Mirrors `boot-reap.it.test.ts`
 * exactly: a `running` row must survive `NODE_ENV=test` and must NOT survive
 * a normal boot, so the pair proves the guard hasn't disabled the reaper
 * outright (server/INSIGHTS.md, 2026-09-27; plan constraint C23).
 *
 * User's Docker lane: `cd server && pnpm exec vitest run .it.test`
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/** Must be a real uuid — see the note at its insert site. */
const DEAD_GENERATION_ID = '00000000-0000-4000-8000-00000000dead';

d('onboarding boot reap (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'onboarding-reap', fullName: 'acme/onboarding-reap' })
      .returning({ id: t.repos.id });
    repoId = repo!.id;
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  /** A `running` onboarding row with no process behind it. */
  async function orphanGeneration(): Promise<void> {
    await pg.handle.db
      .insert(t.onboarding)
      .values({
        repoId,
        json: {},
        status: 'running',
        startedAt: new Date(),
        jobId: null,
        // `generation_id` is a uuid COLUMN. Drizzle types `uuid()` as `string`,
        // so a readable placeholder typechecks and only fails against real
        // Postgres ("invalid input syntax for type uuid").
        generationId: DEAD_GENERATION_ID,
      })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: { status: 'running', startedAt: new Date(), reason: null, jobId: null, generationId: DEAD_GENERATION_ID },
      });
  }

  async function rowOf() {
    const [row] = await pg.handle.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repoId));
    return row;
  }

  function appWith(nodeEnv: 'test' | 'development') {
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: nodeEnv } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient(),
        llm: { openai: new MockLLMProvider('openai') },
      },
    });
  }

  it('leaves a running generation alone under NODE_ENV=test', async () => {
    await orphanGeneration();

    const app = await appWith('test');
    await app.close();

    expect((await rowOf())?.status).toBe('running');
  });

  it('reaps a running generation to failed/generation_failed outside test, clearing every marker column', async () => {
    await orphanGeneration();

    const app = await appWith('development');
    await app.close();

    const row = await rowOf();
    expect(row?.status).toBe('failed');
    expect(row?.reason).toBe('generation_failed');
    expect(row?.startedAt).toBeNull();
    expect(row?.jobId).toBeNull();
    expect(row?.generationId).toBeNull();
  });
});
