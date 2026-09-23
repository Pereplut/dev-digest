/**
 * Intent layer end to end (spec 0008), against a real Postgres.
 *
 * The unit tests cover the rules; this covers the wiring — that a review
 * actually writes a `pr_intent` row, that the trace carries the new slot and
 * its tokens, that the route serves it under a workspace check, and above all
 * that a failing classifier does not take the review down with it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  timeoutMs: 5000,
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 90,
  findings: [],
};

const INTENT_FIXTURE = {
  category: 'feature',
  intent: 'Add a request timeout so a hung upstream cannot pin a worker.',
  in_scope: ['src/config.ts'],
  out_of_scope: ['retry policy'],
  rationale: 'The description says so.',
  evidence: [
    { source_kind: 'body', ref: 'body', quote: 'a hung upstream cannot pin a worker' },
  ],
};

const PR_BODY =
  'Adds a request timeout so a hung upstream cannot pin a worker. Closes #471.';

let repoSeq = 0;
async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  body: string | null = PR_BODY,
) {
  const name = `intent-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 700 + repoSeq,
      title: 'Add a request timeout',
      author: 'marisa.koch',
      branch: 'feat/timeout',
      base: 'main',
      headSha: `sha-${repoSeq}`,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body,
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  timeoutMs: 5000,\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('Intent layer (Testcontainers pg)', () => {
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

  /** `structuredBySchema` lets one run answer both the intent call and the review call. */
  function appWith(intentFixture: unknown | 'throw') {
    const llm = new MockLLMProvider('openai', {
      structured: REVIEW_FIXTURE,
      structuredBySchema:
        intentFixture === 'throw'
          ? { IntentClassification: { category: 'not-a-category' } } // fails the schema
          : { IntentClassification: intentFixture },
    });
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: llm },
      },
    });
  }

  /**
   * Review with ONE agent we control.
   *
   * Not `all: true`: the seeded agents run on `openrouter`, which this app does
   * not override, so fanning out would make real network calls and leave the
   * runs hanging in `running`.
   */
  async function runReview(
    app: Awaited<ReturnType<typeof buildApp>>,
    prId: string,
    expected = 1,
  ) {
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: `Intent Reviewer ${repoSeq}`,
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 'You are a reviewer.',
        },
      })
    ).json();
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    return waitForPrRuns(pg.handle.db, prId, { expected, timeoutMs: 20_000 });
  }

  it('derives, persists and serves an intent, and records it in the trace', async () => {
    const app = await appWith(INTENT_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    await runReview(app, pr.id);

    // --- persisted row
    const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(row).toBeDefined();
    expect(row!.category).toBe('feature');
    expect(row!.confidence).toBe('medium'); // body + a verified quote, no spec
    expect(row!.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.evidence[0]!.valid).toBe(true);
    expect(Number(row!.costUsd ?? 0)).toBeGreaterThanOrEqual(0);

    // --- served by the route
    const served = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(served.statusCode).toBe(200);
    expect(served.json().intent.category).toBe('feature');
    expect(served.json().intent.sources.some((s: { kind: string }) => s.kind === 'body')).toBe(true);

    // --- in the trace
    const runs = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })).json();
    const trace = (
      await app.inject({ method: 'GET', url: `/runs/${runs[0].run_id}/trace` })
    ).json();
    expect(trace.prompt_assembly.intent).toContain('Category: feature');
    expect(trace.prompt_tokens.intent).toBeGreaterThan(0);
    expect(trace.intent_call.reused).toBe(false);
    expect(trace.intent_call.confidence).toBe('medium');
  });

  /** AC4: the classifier must never be able to fail a review. */
  it('completes the review when the classifier fails, with intent_call null', async () => {
    const app = await appWith('throw');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    await runReview(app, pr.id);

    const runs = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })).json();
    expect(runs[0].status).toBe('done');

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runs[0].run_id}/trace` })).json();
    expect(trace.intent_call).toBeNull();
    expect(trace.prompt_assembly.intent ?? null).toBeNull();
    expect(trace.prompt_tokens.intent).toBeUndefined();

    // Nothing persisted, and the route says so plainly.
    const served = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(served.statusCode).toBe(200);
    expect(served.json().intent).toBeNull();
    // The skip is visible in the log — the only trace of a fail-open.
    expect(JSON.stringify(trace.log)).toContain('Intent skipped');
  });

  it('bands a PR with no description as low', async () => {
    const app = await appWith({
      ...INTENT_FIXTURE,
      category: 'unknown',
      intent: 'Unclear from the description.',
      evidence: [],
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, null);

    await runReview(app, pr.id);

    const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(row!.confidence).toBe('low');
    expect(row!.category).toBe('unknown');

    const runs = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })).json();
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runs[0].run_id}/trace` })).json();
    expect(trace.prompt_assembly.intent).toContain('inferred from indirect signals');
  });

  it('reuses the stored intent on a second review of an unchanged PR', async () => {
    const app = await appWith(INTENT_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    await runReview(app, pr.id);
    await runReview(app, pr.id, 2);

    const runs = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })).json();
    const latest = (await app.inject({ method: 'GET', url: `/runs/${runs[0].run_id}/trace` })).json();
    expect(latest.intent_call.reused).toBe(true);
    expect(latest.prompt_assembly.intent).toContain('Category: feature');
  });

  it('404s for a PR in another workspace', async () => {
    const app = await appWith(INTENT_FIXTURE);
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-ws' })
      .returning();
    const { pr } = await setupRepoAndPr(pg.handle.db, other!.id);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(res.statusCode).toBe(404);
  });

  it('has the migrated columns', async () => {
    const cols = await pg.handle.db.execute(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      `select column_name from information_schema.columns where table_name = 'pr_intent'` as any,
    );
    const names = (cols as unknown as { column_name: string }[]).map((c) => c.column_name);
    for (const c of ['category', 'confidence', 'sources', 'evidence', 'input_hash', 'cost_usd']) {
      expect(names).toContain(c);
    }
  });
});
