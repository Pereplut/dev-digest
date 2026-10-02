/**
 * `GET`/`POST /pulls/:id/brief` (spec 0018, S8/S15) — the full stack over a
 * real Postgres: tenancy, grounding-before-persist end to end, the 502
 * mapping on a model failure/timeout with the stored row left untouched, and
 * `GET`'s zero-LLM-call / staleness behaviour.
 *
 * User's Docker lane: `cd server && pnpm exec vitest run .it.test`
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { LLMProvider, ModelInfo, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A full, real `LLMProvider` that always throws — proves the 502 mapping
 *  (AC-14) without waiting out the real 60s `BRIEF_TIMEOUT_MS`: any thrown
 *  error on this path, timeout-shaped or not, must become a 502, never a
 *  bare 500. */
class ThrowingLLMProvider implements LLMProvider {
  readonly id: 'openai' | 'anthropic' | 'openrouter' = 'openai';
  constructor(private readonly message: string) {}
  async listModels(): Promise<ModelInfo[]> {
    return [];
  }
  async complete(): Promise<never> {
    throw new Error(this.message);
  }
  async completeStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    throw new Error(this.message);
  }
  async embed(): Promise<never> {
    throw new Error(this.message);
  }
}

let repoSeq = 0;
async function freshPr(db: PgFixture['handle']['db'], workspaceId: string, paths: string[] = ['src/a.ts']) {
  const name = `brief-route-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 800 + repoSeq,
      title: 'Add rate limiting',
      author: 'a',
      branch: 'b',
      base: 'main',
      headSha: `sha-${repoSeq}`,
      additions: 1,
      deletions: 0,
      filesCount: paths.length,
      status: 'needs_review',
      body: 'Closes #42',
    })
    .returning();
  for (const path of paths) {
    await db.insert(t.prFiles).values({ prId: pr!.id, path, additions: 1, deletions: 0 });
  }
  return { repo: repo!, pr: pr! };
}

d('PR Brief routes (Testcontainers pg)', () => {
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

  function appWith(llm: LLMProvider) {
    return buildApp({ config: config(), db: pg.handle.db, overrides: { llm: { openai: llm } } });
  }

  it('POST generates, grounds away an invented path, and persists the full envelope', async () => {
    const { pr } = await freshPr(pg.handle.db, workspaceId, ['src/a.ts']);
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        PrBriefGeneration: {
          summary: 'A summary.',
          risks: [
            { kind: 'security', title: 'real', explanation: 'e', severity: 'medium', file_refs: ['src/a.ts'] },
            { kind: 'security', title: 'invented', explanation: 'e', severity: 'low', file_refs: ['src/invented.ts'] },
          ],
          review_focus: [
            { file: 'src/a.ts', line: 1, reason: 'real' },
            { file: 'src/invented.ts', line: 1, reason: 'invented' },
          ],
        },
      },
    });
    const app = await appWith(llm);

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // AC-10: no persisted path outside files[].path ∪ the blast map.
    expect(body.risks.risks).toHaveLength(1);
    expect(body.risks.risks[0].title).toBe('real');
    expect(body.review_focus).toHaveLength(1);
    expect(body.review_focus[0].file).toBe('src/a.ts');
    expect(body.head_sha).toBe(pr.headSha);

    const [row] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(row!.json).toEqual(body);

    await app.close();
  });

  it('GET with no row returns 200 with brief: null (AC-21), with no LLM call', async () => {
    const { pr } = await freshPr(pg.handle.db, workspaceId);
    const llm = new MockLLMProvider('openai');
    const app = await appWith(llm);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ brief: null, stale: false });
    expect(llm.calls).toHaveLength(0);

    await app.close();
  });

  it('GET after a successful POST: stale: false, and GET itself makes no LLM call (AC-20, AC-23)', async () => {
    const { pr } = await freshPr(pg.handle.db, workspaceId);
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { PrBriefGeneration: { summary: 's', risks: [], review_focus: [] } },
    });
    const app = await appWith(llm);

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    const callsAfterPost = llm.calls.length;
    expect(callsAfterPost).toBeGreaterThan(0);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json().stale).toBe(false);
    expect(llm.calls).toHaveLength(callsAfterPost); // no new call from GET

    await app.close();
  });

  it('GET after the head moved: stale: true, still no LLM call (AC-22)', async () => {
    const { pr } = await freshPr(pg.handle.db, workspaceId);
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { PrBriefGeneration: { summary: 's', risks: [], review_focus: [] } },
    });
    const app = await appWith(llm);

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    const callsAfterPost = llm.calls.length;

    await pg.handle.db.update(t.pullRequests).set({ headSha: 'a-new-head' }).where(eq(t.pullRequests.id, pr.id));

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    expect(res.json().stale).toBe(true);
    expect(llm.calls).toHaveLength(callsAfterPost);

    await app.close();
  });

  it('AC-14: a provider throw becomes exactly 502, and the stored row is left byte-identical', async () => {
    const { pr } = await freshPr(pg.handle.db, workspaceId);
    const goodLlm = new MockLLMProvider('openai', {
      structuredBySchema: { PrBriefGeneration: { summary: 'good', risks: [], review_focus: [] } },
    });
    const appGood = await appWith(goodLlm);
    await appGood.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    const before = (await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id)))[0];
    await appGood.close();

    const appBad = await appWith(new ThrowingLLMProvider('upstream 500'));
    const res = await appBad.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });

    expect(res.statusCode).toBe(502);
    const after = (await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id)))[0];
    expect(after).toEqual(before);

    await appBad.close();
  });

  it('AC-14: a timeout-shaped failure also becomes exactly 502, not a bare 500', async () => {
    const { pr } = await freshPr(pg.handle.db, workspaceId);
    const app = await appWith(new ThrowingLLMProvider('Request timed out after 60000ms'));

    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('external_service_error');

    const [row] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(row).toBeUndefined(); // no prior row, and the failed call wrote nothing

    await app.close();
  });

  it('404s for an unknown pull request on both GET and POST', async () => {
    const llm = new MockLLMProvider('openai');
    const app = await appWith(llm);
    const unknownId = '00000000-0000-4000-8000-000000000000';

    const get = await app.inject({ method: 'GET', url: `/pulls/${unknownId}/brief` });
    expect(get.statusCode).toBe(404);
    const post = await app.inject({ method: 'POST', url: `/pulls/${unknownId}/brief` });
    expect(post.statusCode).toBe(404);
    expect(llm.calls).toHaveLength(0);

    await app.close();
  });
});
