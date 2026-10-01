/**
 * Onboarding generation lifecycle concurrency (AC-19, AC-20, AC-21). Real
 * Postgres: the claim statement's conditional upsert is the mechanism under
 * test, which a hermetic stub cannot exercise meaningfully.
 *
 * User's Docker lane: `cd server && pnpm exec vitest run .it.test`
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and, count } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { ONBOARDING_JOB_KIND, GENERATION_STALE_MS } from '../src/modules/onboarding/constants.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

function ok<T>(res: { statusCode: number; json: () => unknown; body: string }, status = 202): T {
  if (res.statusCode !== status) {
    throw new Error(`expected ${status}, got ${res.statusCode}: ${res.body}`);
  }
  return res.json() as T;
}

/** A minimal, always-healthy repoIntel so the precondition ladder resolves to null. */
function healthyRepoIntel(): RepoIntel {
  return {
    indexRepo: async () => ({ status: 'full', filesIndexed: 1, filesSkipped: 0, durationMs: 1 }),
    refreshIndex: async () => ({ status: 'full', filesIndexed: 1, filesSkipped: 0, durationMs: 1 }),
    getIndexState: async () => ({
      repoId: 'x',
      status: 'full',
      filesIndexed: 10,
      filesSkipped: 0,
      durationMs: 1,
      lastIndexedSha: 'sha',
      indexerVersion: 2,
      updatedAt: new Date(),
    }),
    getBlastRadius: async () => ({ changedSymbols: [], callers: [], impactedEndpoints: [] }),
    getRepoMap: async () => ({ text: '', tokens: 0, cached: false }),
    getFileRank: async () => [],
    getSymbolsInFiles: async () => [],
    getCallerSignatures: async () => [],
    getUnresolvedReferences: async () => [],
    getConventionSamples: async () => [],
    getTopFilesByRank: async () => ['src/app.ts'],
    getCriticalPaths: async () => [],
  } as unknown as RepoIntel;
}

d('onboarding generation concurrency (Testcontainers pg)', () => {
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

  async function freshRepo(name: string): Promise<string> {
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning({ id: t.repos.id });
    return repo!.id;
  }

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({}),
        repoIntel: healthyRepoIntel(),
        llm: {
          openrouter: new MockLLMProvider('openai', {
            structuredBySchema: {
              OnboardingDraft: {
                sections: (['architecture', 'critical_paths', 'run_locally', 'reading_path', 'first_tasks'] as const).map(
                  (kind) => ({ kind, body: 'Grounded body text.', diagram: null, links: [] }),
                ),
              },
            },
          }),
        },
      },
    });
  }

  async function jobCountFor(repoId: string): Promise<number> {
    const [row] = await pg.handle.db
      .select({ n: count() })
      .from(t.jobs)
      .where(and(eq(t.jobs.workspaceId, workspaceId), eq(t.jobs.kind, ONBOARDING_JOB_KIND)));
    void repoId; // jobs carries no repo_id column; scoped by workspace + kind only
    return Number(row?.n ?? 0);
  }

  it('AC-21: two concurrent POSTs for the same repo enqueue exactly one job', async () => {
    const repoId = await freshRepo('concurrency-fresh');
    const app = await makeApp();
    const before = await jobCountFor(repoId);

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding` }),
      app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding` }),
    ]);
    const bodyA = ok<{ job_id: string | null }>(a);
    const bodyB = ok<{ job_id: string | null }>(b);

    const after = await jobCountFor(repoId);
    expect(after - before).toBe(1);
    // Exactly one of the two carries the real job_id; the other is the
    // loser, which may read it as null (decision 2's window) or the same id.
    expect([bodyA.job_id, bodyB.job_id].some((j) => j !== null)).toBe(true);

    await app.close();
  });

  it('AC-19: a fresh running generation makes POST respond 202 with the EXISTING job_id and enqueue nothing', async () => {
    const repoId = await freshRepo('concurrency-running-fresh');
    await pg.handle.db.insert(t.onboarding).values({
      repoId,
      json: {},
      status: 'running',
      startedAt: new Date(),
      jobId: '00000000-0000-0000-0000-000000000001',
      generationId: 'existing-generation',
    });

    const app = await makeApp();
    const before = await jobCountFor(repoId);

    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding` });
    const body = ok<{ job_id: string | null }>(res);

    expect(body.job_id).toBe('00000000-0000-0000-0000-000000000001');
    expect(await jobCountFor(repoId)).toBe(before);

    await app.close();
  });

  it('AC-20: a stale running generation is failed and a new one starts', async () => {
    const repoId = await freshRepo('concurrency-stale');
    await pg.handle.db.insert(t.onboarding).values({
      repoId,
      json: {},
      status: 'running',
      startedAt: new Date(Date.now() - GENERATION_STALE_MS - 1_000),
      jobId: '00000000-0000-0000-0000-000000000002',
      generationId: 'stale-generation',
    });

    const app = await makeApp();
    const before = await jobCountFor(repoId);

    const res = await app.inject({ method: 'POST', url: `/repos/${repoId}/onboarding` });
    const body = ok<{ job_id: string | null }>(res);

    expect(body.job_id).not.toBe('00000000-0000-0000-0000-000000000002');
    expect(await jobCountFor(repoId)).toBe(before + 1);

    await app.close();
  });
});
