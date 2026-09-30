/**
 * GET /runs/:id/findings (spec 0011) — severity/category filters and keyset
 * pagination, all resolved in SQL, plus the run's own status.
 *
 * The assertions that matter are the SAME ones `pulls-pagination.it.test.ts`
 * cares about for its own keyset: the filter/limit/cursor behaviour, not just
 * the happy path — a wrong predicate still returns a plausible-looking page
 * while silently dropping or repeating rows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { RunFindingsPage, Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A hunk adding 5 new lines (11-15), so 5 findings can each cite a distinct
 * real diff line and all survive citation grounding.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,8 @@
   port: 3000,
+  line11: 1,
+  line12: 2,
+  line13: 3,
+  line14: 4,
+  line15: 5,
   redisUrl: x,`;

/** 5 findings spanning every severity and category, one per diff line. */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Mixed findings for pagination coverage.',
  score: 40,
  findings: [
    {
      id: 'f-crit-security',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Critical security finding',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'r1',
      confidence: 0.9,
      kind: 'finding',
    },
    {
      id: 'f-crit-bug',
      severity: 'CRITICAL',
      category: 'bug',
      title: 'Critical bug finding',
      file: 'src/config.ts',
      start_line: 12,
      end_line: 12,
      rationale: 'r2',
      confidence: 0.9,
      kind: 'finding',
    },
    {
      id: 'f-warn-perf',
      severity: 'WARNING',
      category: 'perf',
      title: 'Warning perf finding',
      file: 'src/config.ts',
      start_line: 13,
      end_line: 13,
      rationale: 'r3',
      confidence: 0.7,
      kind: 'finding',
    },
    {
      id: 'f-warn-style',
      severity: 'WARNING',
      category: 'style',
      title: 'Warning style finding',
      file: 'src/config.ts',
      start_line: 14,
      end_line: 14,
      rationale: 'r4',
      confidence: 0.7,
      kind: 'finding',
    },
    {
      id: 'f-sugg-test',
      severity: 'SUGGESTION',
      category: 'test',
      title: 'Suggestion test finding',
      file: 'src/config.ts',
      start_line: 15,
      end_line: 15,
      rationale: 'r5',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `findings-page-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 501,
      title: 'Add config knobs',
      author: 'marisa.koch',
      branch: 'feat/config',
      base: 'main',
      headSha: 'f1e2d3c4',
      additions: 5,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

d('GET /runs/:id/findings (Testcontainers pg)', () => {
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

  function appWith(structured: unknown) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured }) },
      },
    });
  }

  /** Fetch a page and fail loudly, with the server's own message, on non-200. */
  async function getPage(
    app: Awaited<ReturnType<typeof appWith>>,
    url: string,
  ): Promise<RunFindingsPage> {
    const res = await app.inject({ method: 'GET', url });
    if (res.statusCode !== 200) {
      throw new Error(`GET ${url} -> ${res.statusCode}: ${res.payload}`);
    }
    return res.json() as RunFindingsPage;
  }

  /** Run the fixture review to completion and return its run id + PR. */
  async function runToCompletion(app: Awaited<ReturnType<typeof appWith>>) {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `Agent-${repoSeq}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    const started = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const runId = started.runs[0].run_id as string;
    return { pr, runId };
  }

  it('filters by severity in SQL', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { runId } = await runToCompletion(app);

    const page = await getPage(app, `/runs/${runId}/findings?severity=CRITICAL`);

    expect(page.findings).toHaveLength(2);
    expect(page.findings.every((f) => f.severity === 'CRITICAL')).toBe(true);
    expect(page.status).toBe('done');

    await app.close();
  });

  it('accepts a repeated severity key as a multi-value filter', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { runId } = await runToCompletion(app);

    // Fastify's querystring parser returns a bare string for one occurrence
    // and an array only once the key repeats — both forms must resolve in SQL.
    const page = await getPage(app, `/runs/${runId}/findings?severity=CRITICAL&severity=WARNING`);

    expect(page.findings).toHaveLength(4);
    expect(page.findings.every((f) => f.severity === 'CRITICAL' || f.severity === 'WARNING')).toBe(
      true,
    );

    await app.close();
  });

  it('filters by category in SQL', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { runId } = await runToCompletion(app);

    const page = await getPage(app, `/runs/${runId}/findings?category=perf`);

    expect(page.findings).toHaveLength(1);
    expect(page.findings[0]!.category).toBe('perf');

    await app.close();
  });

  it('combines severity AND category filters', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { runId } = await runToCompletion(app);

    const page = await getPage(app, `/runs/${runId}/findings?severity=WARNING&category=style`);

    expect(page.findings).toHaveLength(1);
    expect(page.findings[0]!.title).toBe('Warning style finding');

    await app.close();
  });

  it('bounds the page with limit and returns a cursor when more remain', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { runId } = await runToCompletion(app);

    const page = await getPage(app, `/runs/${runId}/findings?limit=2`);

    expect(page.findings).toHaveLength(2);
    expect(page.next_cursor).toBeTruthy();

    const wholePage = await getPage(app, `/runs/${runId}/findings?limit=50`);
    expect(wholePage.findings).toHaveLength(5);
    expect(wholePage.next_cursor).toBeNull();

    await app.close();
  });

  it('walks every finding exactly once across two pages, worst severity first', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { runId } = await runToCompletion(app);

    const whole = await getPage(app, `/runs/${runId}/findings?limit=50`);
    const expectedIds = whole.findings.map((f) => f.id);

    const seenIds: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const qs = new URLSearchParams({ limit: '2' });
      if (cursor) qs.set('cursor', cursor);
      const page = await getPage(app, `/runs/${runId}/findings?${qs.toString()}`);
      seenIds.push(...page.findings.map((f) => f.id));
      cursor = page.next_cursor;
      if (!cursor) break;
    }

    expect(seenIds).toHaveLength(5);
    expect(new Set(seenIds).size).toBe(5); // every finding exactly once
    expect(seenIds).toEqual(expectedIds); // paging must not reshuffle
    // CRITICAL findings sort ahead of WARNING and SUGGESTION.
    const severities = whole.findings.map((f) => f.severity);
    expect(severities.slice(0, 2).sort()).toEqual(['CRITICAL', 'CRITICAL']);
    expect(severities.at(-1)).toBe('SUGGESTION');

    await app.close();
  });

  it('rejects a malformed cursor with 400 rather than silently serving page one', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { runId } = await runToCompletion(app);

    const res = await app.inject({ method: 'GET', url: `/runs/${runId}/findings?cursor=not-a-cursor` });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('a run still executing returns its status and no findings', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const [run] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId: pr.id, provider: 'openai', model: 'gpt-4.1', status: 'running' })
      .returning();

    const page = await getPage(app, `/runs/${run!.id}/findings`);

    expect(page.status).toBe('running');
    expect(page.findings).toEqual([]);
    expect(page.next_cursor).toBeNull();

    await app.close();
  });

  it('404s for an unknown run id', async () => {
    const app = await appWith(REVIEW_FIXTURE);

    const res = await app.inject({ method: 'GET', url: `/runs/${randomUUID()}/findings` });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  // `grounding` travels with `status` so a caller can tell a clean review from a
  // review of nothing: both are `done` with `findings: []`. Live on
  // acme/payments-api#482 (all four files `patch: NULL`) the value was
  // "0/0 passed" — which is why the tally has to reach the caller at all.
  it('returns the run grounding tally alongside status', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { runId } = await runToCompletion(app);

    const page = await getPage(app, `/runs/${runId}/findings`);

    expect(page.status).toBe('done');
    // The fixture's findings all cite a real diff line, so every one grounds.
    expect(page.grounding).toMatch(/^\d+\/\d+ passed$/);

    await app.close();
  });
});
