/**
 * `buildApp()` must NOT reap `running` agent_runs when `NODE_ENV=test`.
 *
 * Regression, 2026-09-27: `loadConfig` takes `databaseUrl` straight from the
 * ambient environment with no test override, so a test boot reaped the
 * DEVELOPER'S database. `test/routes-smoke.test.ts` boots six times, and
 * `LOG_LEVEL` is forced to 'silent' under test, so three in-flight reviews died
 * as `failed` with no error, no grounding, no duration and no log line anywhere
 * — the null-everywhere signature that belonged to `reapOrphanedRunningRuns`
 * (named `reapStaleRunningRuns` at the time) alone.
 * See server/INSIGHTS.md (2026-09-27).
 *
 * The pair of tests below is the point: asserting only the skip would pass just
 * as well if the reaper had been deleted outright, so the non-test boot has to
 * be shown still reaping.
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

d('buildApp boot reaping (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  /** A `running` agent_runs row with no process behind it. */
  async function orphanRun(): Promise<string> {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: `Reap-${Math.random().toString(36).slice(2, 8)}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 's',
      })
      .returning({ id: t.agents.id });

    const [run] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, agentId: agent!.id, status: 'running', source: 'local' })
      .returning({ id: t.agentRuns.id });
    return run!.id;
  }

  async function statusOf(runId: string): Promise<string | null> {
    const [row] = await pg.handle.db
      .select({ status: t.agentRuns.status })
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, runId));
    return row?.status ?? null;
  }

  async function errorOf(runId: string): Promise<string | null> {
    const [row] = await pg.handle.db
      .select({ error: t.agentRuns.error })
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, runId));
    return row?.error ?? null;
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

  it('leaves a running run alone under NODE_ENV=test', async () => {
    const runId = await orphanRun();

    const app = await appWith('test');
    await app.close();

    expect(await statusOf(runId)).toBe('running');
  });

  it('still reaps a running run outside test, so the guard has not disabled the reaper', async () => {
    const runId = await orphanRun();

    const app = await appWith('development');
    await app.close();

    expect(await statusOf(runId)).toBe('failed');
  });

  it('records WHY the run was reaped, so a dead run is diagnosable instead of blank', async () => {
    // Regression, 2026-09-27 INSIGHTS: a reaped run used to persist `failed`
    // with no error, no grounding and no duration — indistinguishable from a
    // silent crash. The reaper now explains itself.
    const runId = await orphanRun();

    const app = await appWith('development');
    await app.close();

    expect(await errorOf(runId)).toBe('Orphaned by an API restart (reaped on boot)');
  });
});
