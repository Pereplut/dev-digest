/**
 * POST /eval-cases, GET /agents/:id/eval-cases, PATCH /eval-cases/:id,
 * DELETE /eval-cases/:id (spec 0019). AC-21 through AC-30, AC-66, AC-67.
 *
 * Written against the Docker lane (`pnpm exec vitest run .it.test`) — not run
 * by the implementer, per server/AGENTS.md's Docker-contention rule.
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

let repoSeq = 0;

d('evals: case creation / read / edit / delete (Testcontainers pg)', () => {
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

  async function createRepoAndPr(withPatches: { path: string; patch: string }[]) {
    const db = pg.handle.db;
    const name = `eval-cases-${repoSeq++}`;
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
        filesCount: withPatches.length,
        status: 'needs_review',
      })
      .returning();
    for (const { path, patch } of withPatches) {
      await db.insert(t.prFiles).values({ prId: pr!.id, path, additions: 1, deletions: 0, patch });
    }
    return { repo: repo!, pr: pr! };
  }

  async function createAgent(db = pg.handle.db) {
    const [agent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: `Agent-${randomUUID()}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'review',
      })
      .returning();
    return agent!;
  }

  /** One review with an accepted, a dismissed, and an open finding, each on its own file. */
  async function seedReviewWithFindings(agentId: string) {
    const { pr } = await createRepoAndPr([
      { path: 'src/config.ts', patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "x",\n   redisUrl: y,' },
      { path: 'src/other.ts', patch: '@@ -1,2 +1,3 @@\n a\n+b\n c' },
      { path: 'src/open.ts', patch: '@@ -1,1 +1,2 @@\n a\n+b' },
    ]);
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr.id,
        agentId,
        runId: null,
        kind: 'review',
        verdict: 'comment',
        summary: 's',
        score: 90,
        model: 'gpt-4.1',
      })
      .returning();
    const [accepted] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 11,
        endLine: 11,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded secret',
        rationale: 'r',
        confidence: 0.9,
        acceptedAt: new Date(),
      })
      .returning();
    const [dismissed] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/other.ts',
        startLine: 2,
        endLine: 2,
        severity: 'WARNING',
        category: 'bug',
        title: 'Noise',
        rationale: 'r',
        confidence: 0.5,
        dismissedAt: new Date(),
      })
      .returning();
    const [open] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/open.ts',
        startLine: 2,
        endLine: 2,
        severity: 'SUGGESTION',
        category: 'style',
        title: 'Open',
        rationale: 'r',
        confidence: 0.4,
      })
      .returning();
    return { pr, review: review!, accepted: accepted!, dismissed: dismissed!, open: open! };
  }

  it('201 + one row for an accepted finding, with derived owner/kind/target fields and source_finding_id', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const agent = await createAgent();
    const { accepted } = await seedReviewWithFindings(agent.id);

    const res = await app.inject({ method: 'POST', url: '/eval-cases', payload: { finding_id: accepted.id } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.owner_kind).toBe('agent');
    expect(body.owner_id).toBe(agent.id);
    expect(body.expectation_kind).toBe('must_find');
    expect(body.expected_file).toBe('src/config.ts');
    expect(body.expected_start_line).toBe(11);
    expect(body.expected_end_line).toBe(11);
    expect(body.source_finding_id).toBe(accepted.id);

    const rows = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.sourceFindingId, accepted.id));
    expect(rows).toHaveLength(1);
  });

  it('201 for a dismissed finding derives must_not_flag', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const agent = await createAgent();
    const { dismissed } = await seedReviewWithFindings(agent.id);

    const res = await app.inject({ method: 'POST', url: '/eval-cases', payload: { finding_id: dismissed.id } });
    expect(res.statusCode).toBe(201);
    expect(res.json().expectation_kind).toBe('must_not_flag');
  });

  it("input_diff is a SNAPSHOT: mutating the PR's pr_files patch afterwards does not change it", async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const agent = await createAgent();
    const { pr, accepted } = await seedReviewWithFindings(agent.id);

    const created = (
      await app.inject({ method: 'POST', url: '/eval-cases', payload: { finding_id: accepted.id } })
    ).json();
    const before = created.input_diff as string;
    expect(before.length).toBeGreaterThan(0);

    await pg.handle.db
      .update(t.prFiles)
      .set({ patch: '@@ -1,1 +1,1 @@\n totally different' })
      .where(eq(t.prFiles.prId, pr.id));

    const [row] = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.id, created.id));
    expect(row!.inputDiff).toBe(before);
  });

  it('422 validation_error for an open finding (neither accepted nor dismissed), no row', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const agent = await createAgent();
    const { open } = await seedReviewWithFindings(agent.id);

    const res = await app.inject({ method: 'POST', url: '/eval-cases', payload: { finding_id: open.id } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');

    const rows = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.sourceFindingId, open.id));
    expect(rows).toHaveLength(0);
  });

  it('422 naming the reason when the PR has no loadable diff (no git, no pr_files)', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const agent = await createAgent();
    const { pr } = await createRepoAndPr([]); // no pr_files rows at all
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId: pr.id, agentId: agent.id, runId: null, kind: 'review', verdict: null, summary: null, score: null, model: null })
      .returning();
    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/nope.ts',
        startLine: 1,
        endLine: 1,
        severity: 'WARNING',
        category: 'bug',
        title: 'x',
        rationale: 'r',
        confidence: 0.5,
        acceptedAt: new Date(),
      })
      .returning();

    const res = await app.inject({ method: 'POST', url: '/eval-cases', payload: { finding_id: finding!.id } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    expect(res.json().error.message).toMatch(/diff/i);
  });

  it('409 conflict on the same finding posted twice; row count stays 1; a different finding still 201', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const agent = await createAgent();
    const { accepted } = await seedReviewWithFindings(agent.id);

    const first = await app.inject({ method: 'POST', url: '/eval-cases', payload: { finding_id: accepted.id } });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: '/eval-cases', payload: { finding_id: accepted.id } });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('conflict');

    const rows = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.sourceFindingId, accepted.id));
    expect(rows).toHaveLength(1);

    // positive control: a DIFFERENT accepted finding on the same agent is fine.
    const { accepted: secondFinding } = await seedReviewWithFindings(agent.id);
    const third = await app.inject({ method: 'POST', url: '/eval-cases', payload: { finding_id: secondFinding.id } });
    expect(third.statusCode).toBe(201);
  });

  it('GET /agents/:id/eval-cases orders newest-first with an id tiebreak, scoped to the agent', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const agent = await createAgent();
    const otherAgent = await createAgent();

    const t0 = new Date('2026-01-01T00:00:00Z');
    const mk = async (ownerId: string, name: string, createdAt: Date, sourceFindingId: string | null) =>
      (
        await pg.handle.db
          .insert(t.evalCases)
          .values({
            workspaceId,
            ownerKind: 'agent',
            ownerId,
            name,
            expectationKind: 'must_find',
            expectedFile: 'src/a.ts',
            expectedStartLine: 1,
            expectedEndLine: 1,
            sourceFindingId,
            createdAt,
          })
          .returning()
      )[0]!;

    const c1 = await mk(agent.id, 'c1', t0, null);
    const c2 = await mk(agent.id, 'c2', t0, null); // same createdAt as c1 — id tiebreak
    const c3 = await mk(agent.id, 'c3', new Date('2026-01-02T00:00:00Z'), null);
    await mk(otherAgent.id, 'other', t0, null); // a different agent's case

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
    expect(res.statusCode).toBe(200);
    const ids = res.json().map((c: { id: string }) => c.id);
    expect(ids[0]).toBe(c3.id); // newest createdAt first
    const tied = [c1.id, c2.id].sort();
    expect(ids.slice(1)).toEqual(tied); // id ascending tiebreak
  });

  it('PATCH name alone leaves expected_file intact; 200 with the updated case', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const agent = await createAgent();
    const { accepted } = await seedReviewWithFindings(agent.id);
    const created = (
      await app.inject({ method: 'POST', url: '/eval-cases', payload: { finding_id: accepted.id } })
    ).json();

    const res = await app.inject({
      method: 'PATCH',
      url: `/eval-cases/${created.id}`,
      payload: { name: 'renamed' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('renamed');
    expect(body.expected_file).toBe(created.expected_file);
    expect(body.expected_start_line).toBe(created.expected_start_line);
  });

  it('PATCH with an empty body is 422, not 500 (EvalCasePatch requires at least one field)', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const agent = await createAgent();
    const { accepted } = await seedReviewWithFindings(agent.id);
    const created = (
      await app.inject({ method: 'POST', url: '/eval-cases', payload: { finding_id: accepted.id } })
    ).json();

    const res = await app.inject({
      method: 'PATCH',
      url: `/eval-cases/${created.id}`,
      payload: {},
    });
    expect(res.statusCode).toBe(422);
  });

  it('DELETE removes the case and its eval_runs rows', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const agent = await createAgent();
    const { accepted } = await seedReviewWithFindings(agent.id);
    const created = (
      await app.inject({ method: 'POST', url: '/eval-cases', payload: { finding_id: accepted.id } })
    ).json();

    const [batch] = await pg.handle.db
      .insert(t.evalRunBatches)
      .values({ workspaceId, ownerKind: 'agent', ownerId: agent.id, agentId: agent.id, agentVersion: 1, casesTotal: 1 })
      .returning();
    await pg.handle.db.insert(t.evalRuns).values({ caseId: created.id, batchId: batch!.id, pass: true });

    const res = await app.inject({ method: 'DELETE', url: `/eval-cases/${created.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const cases = await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.id, created.id));
    expect(cases).toHaveLength(0);
    const runs = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, created.id));
    expect(runs).toHaveLength(0);
  });

  it("404 not_found for another workspace's case on GET/PATCH/DELETE, and for GET /eval-runs/:batchId", async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });

    // A real SECOND workspace — LocalNoAuthProvider always resolves the
    // DEFAULT one for an in-process request, so a resource genuinely scoped to
    // another workspace's id is how "foreign workspace" is exercised here
    // (same pattern as test/skills.it.test.ts's "a skill from another workspace").
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: `other-${randomUUID()}` }).returning();
    // The foreign owner must be a REAL agent row, not a bare uuid. The two
    // tables disagree on purpose: `eval_cases.owner_id` is polymorphic over
    // skill|agent and carries no FK, so an invented uuid inserts happily there —
    // but `eval_run_batches.agent_id` DOES have an FK to `agents.id`, so the
    // same uuid fails with `eval_run_batches_agent_id_agents_id_fk`. An earlier
    // version of this fixture assumed the symmetry and broke on the batch insert.
    const [foreignAgent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: otherWs!.id,
        name: `Foreign-${randomUUID()}`,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'review',
      })
      .returning();
    const foreignAgentId = foreignAgent!.id;
    const [foreignCase] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId: otherWs!.id,
        ownerKind: 'agent',
        ownerId: foreignAgentId,
        name: 'foreign',
        expectationKind: 'must_find',
        expectedFile: 'src/a.ts',
        expectedStartLine: 1,
        expectedEndLine: 1,
      })
      .returning();
    const [foreignBatch] = await pg.handle.db
      .insert(t.evalRunBatches)
      .values({
        workspaceId: otherWs!.id,
        ownerKind: 'agent',
        ownerId: foreignAgentId,
        agentId: foreignAgentId,
        agentVersion: 1,
        casesTotal: 1,
      })
      .returning();

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/eval-cases/${foreignCase!.id}`,
      payload: { name: 'x' },
    });
    expect(patchRes.statusCode).toBe(404);
    expect(patchRes.json().error.code).toBe('not_found');

    const delRes = await app.inject({ method: 'DELETE', url: `/eval-cases/${foreignCase!.id}` });
    expect(delRes.statusCode).toBe(404);

    const batchRes = await app.inject({ method: 'GET', url: `/eval-runs/${foreignBatch!.id}` });
    expect(batchRes.statusCode).toBe(404);
  });
});
