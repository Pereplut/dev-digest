/**
 * GET /agents/:id/eval-runs/compare (spec 0020 AC-20 – AC-27, AC-86).
 * Written against the Docker lane (`pnpm exec vitest run .it.test`) — not
 * run by the implementer, per server/AGENTS.md's Docker-contention rule.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { EvalRunComparison } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Deep scan for a key name anywhere in a JSON-shaped value — the AC-27 check. */
function findKey(value: unknown, key: string): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => findKey(v, key));
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === key) return true;
    if (findKey(v, key)) return true;
  }
  return false;
}

d('GET /agents/:id/eval-runs/compare (spec 0020, Testcontainers pg)', () => {
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

  function appWith() {
    return buildApp({ config: config(), db: pg.handle.db });
  }

  async function createAgent() {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name: `Agent-${randomUUID()}`, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'review', version: 1 })
      .returning();
    return agent!;
  }

  function versionConfig(overrides: Record<string, unknown> = {}) {
    return {
      provider: 'openai',
      model: 'gpt-4.1',
      system_prompt: 'review carefully',
      output_schema: null,
      strategy: 'single-pass',
      ci_fail_on: 'critical',
      repo_intel: true,
      skills: [],
      ...overrides,
    };
  }

  async function mkBatch(
    agentId: string,
    ranAt: Date,
    overrides: Partial<typeof t.evalRunBatches.$inferInsert> = {},
  ) {
    const [row] = await pg.handle.db
      .insert(t.evalRunBatches)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agentId,
        agentId,
        agentVersion: 1,
        casesTotal: 2,
        casesPassed: 1,
        status: 'done',
        ranAt,
        recall: 0.5,
        precision: 0.5,
        citationAccuracy: 0.9,
        costUsd: '0.01',
        ...overrides,
      })
      .returning();
    return row!;
  }

  it('AC-20: old = earlier ran_at regardless of query order; identical bodies both ways', async () => {
    const agent = await createAgent();
    const old = await mkBatch(agent.id, new Date('2026-01-01T00:00:00Z'));
    const nu = await mkBatch(agent.id, new Date('2026-01-02T00:00:00Z'));
    const app = await appWith();

    const forward = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/eval-runs/compare?a=${old.id}&b=${nu.id}`,
    });
    const backward = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/eval-runs/compare?a=${nu.id}&b=${old.id}`,
    });
    expect(forward.statusCode).toBe(200);
    const fBody = EvalRunComparison.parse(forward.json());
    const bBody = EvalRunComparison.parse(backward.json());
    expect(fBody.old.id).toBe(old.id);
    expect(fBody.new.id).toBe(nu.id);
    expect(fBody).toEqual(bBody);
    await app.close();
  });

  it('AC-21: an unknown id, another agent\'s batch id, and another workspace\'s batch id each 404', async () => {
    const agent = await createAgent();
    const other = await createAgent();
    const a = await mkBatch(agent.id, new Date('2026-01-01T00:00:00Z'));
    const foreignAgentBatch = await mkBatch(other.id, new Date('2026-01-02T00:00:00Z'));

    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: `other-${randomUUID()}` }).returning();
    const [foreignWsBatch] = await pg.handle.db
      .insert(t.evalRunBatches)
      .values({ workspaceId: otherWs!.id, ownerKind: 'agent', ownerId: agent.id, agentId: agent.id, agentVersion: 1, casesTotal: 1, status: 'done' })
      .returning();

    const app = await appWith();
    const ghost = '00000000-0000-0000-0000-000000000000';
    for (const otherId of [ghost, foreignAgentBatch.id, foreignWsBatch!.id]) {
      const res = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/eval-runs/compare?a=${a.id}&b=${otherId}`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('not_found');
    }
    await app.close();
  });

  it('AC-22: the same id twice is 422 validation_error', async () => {
    const agent = await createAgent();
    const a = await mkBatch(agent.id, new Date('2026-01-01T00:00:00Z'));
    const app = await appWith();
    const res = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/eval-runs/compare?a=${a.id}&b=${a.id}`,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });

  it('AC-23: a cancelled batch and a running batch each 422, naming the status', async () => {
    const agent = await createAgent();
    const done = await mkBatch(agent.id, new Date('2026-01-01T00:00:00Z'));
    const cancelled = await mkBatch(agent.id, new Date('2026-01-02T00:00:00Z'), { status: 'cancelled' });
    const running = await mkBatch(agent.id, new Date('2026-01-03T00:00:00Z'), { status: 'running' });
    const app = await appWith();

    const r1 = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs/compare?a=${done.id}&b=${cancelled.id}` });
    expect(r1.statusCode).toBe(422);
    expect(r1.json().error.message).toContain('cancelled');

    const r2 = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs/compare?a=${done.id}&b=${running.id}` });
    expect(r2.statusCode).toBe(422);
    expect(r2.json().error.message).toContain('running');
    await app.close();
  });

  it('AC-23 (either side): the non-done batch is rejected whether it is query param `a` or `b`', async () => {
    // The two cases above only ever put the bad batch in `b`. The guard loops
    // over the fetched pair (service.ts's `for (const batch of pair)`), not
    // over `[idA, idB]` in request order, so this pins down that the check
    // does not silently depend on which side the client happens to put the
    // unfinished batch.
    const agent = await createAgent();
    const done = await mkBatch(agent.id, new Date('2026-01-01T00:00:00Z'));
    const cancelled = await mkBatch(agent.id, new Date('2026-01-02T00:00:00Z'), { status: 'cancelled' });
    const app = await appWith();

    const res = await app.inject({
      method: 'GET',
      url: `/agents/${agent.id}/eval-runs/compare?a=${cancelled.id}&b=${done.id}`,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    expect(res.json().error.message).toContain('cancelled');
    await app.close();
  });

  it('AC-24/AC-25/AC-89/AC-90: an unrecorded-vs-recorded pair is incomparable under the UNRECORDED reason (not mismatch), withholds the three metric deltas, computes cost_usd; same-version pair is fully comparable', async () => {
    const agent = await createAgent();
    const v1 = await mkBatch(agent.id, new Date('2026-01-01T00:00:00Z'), { metricsVersion: 1, costUsd: '0.01' });
    const v2 = await mkBatch(agent.id, new Date('2026-01-02T00:00:00Z'), { metricsVersion: 2, costUsd: '0.03' });
    const app = await appWith();

    const unrecordedPair = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs/compare?a=${v1.id}&b=${v2.id}` });
    const unrecordedBody = EvalRunComparison.parse(unrecordedPair.json());
    expect(unrecordedBody.comparable).toBe(false);
    // AC-89: EITHER side unrecorded (1 vs 2) is the unrecorded code, not a mismatch.
    expect(unrecordedBody.incomparable_reason).toBe('metrics_version_unrecorded');
    expect(unrecordedBody.delta.recall).toBeNull();
    expect(unrecordedBody.delta.precision).toBeNull();
    expect(unrecordedBody.delta.citation_accuracy).toBeNull();
    expect(unrecordedBody.delta.cost_usd).toBeCloseTo(0.02);

    // AC-90: two DIFFERING but BOTH-recorded versions get the genuine mismatch code.
    const v2b = await mkBatch(agent.id, new Date('2026-01-03T00:00:00Z'), { metricsVersion: 2 });
    const v3 = await mkBatch(agent.id, new Date('2026-01-04T00:00:00Z'), { metricsVersion: 3 });
    const recordedMismatch = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs/compare?a=${v2b.id}&b=${v3.id}` });
    const recordedMismatchBody = EvalRunComparison.parse(recordedMismatch.json());
    expect(recordedMismatchBody.comparable).toBe(false);
    expect(recordedMismatchBody.incomparable_reason).toBe('metrics_version_mismatch');

    const sameA = await mkBatch(agent.id, new Date('2026-01-03T00:00:00Z'), { metricsVersion: 2 });
    const sameB = await mkBatch(agent.id, new Date('2026-01-04T00:00:00Z'), { metricsVersion: 2 });
    const both = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs/compare?a=${sameA.id}&b=${sameB.id}` });
    const bothBody = EvalRunComparison.parse(both.json());
    expect(bothBody.comparable).toBe(true);
    expect(bothBody.incomparable_reason).toBeNull();
    await app.close();
  });

  it('AC-24 (amended): two version-1 batches are STILL incomparable (1 means "formula unknown", not "the old formula") — a distinct reason from a mismatch', async () => {
    const agent = await createAgent();
    const legacyA = await mkBatch(agent.id, new Date('2026-01-01T00:00:00Z'), { metricsVersion: 1 });
    const legacyB = await mkBatch(agent.id, new Date('2026-01-02T00:00:00Z'), { metricsVersion: 1 });
    const app = await appWith();

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs/compare?a=${legacyA.id}&b=${legacyB.id}` });
    const body = EvalRunComparison.parse(res.json());
    expect(body.comparable).toBe(false);
    expect(body.incomparable_reason).toBe('metrics_version_unrecorded');
    // Distinct from the genuine version-mismatch code asserted above.
    expect(body.incomparable_reason).not.toBe('metrics_version_mismatch');
    await app.close();
  });

  it('AC-26/AC-27: configs come from the matching agent_versions snapshot; a deleted one is null; no actual_output or findings anywhere in the body', async () => {
    const agent = await createAgent();
    const a = await mkBatch(agent.id, new Date('2026-01-01T00:00:00Z'), { agentVersion: 10 });
    const b = await mkBatch(agent.id, new Date('2026-01-02T00:00:00Z'), { agentVersion: 11 });
    await pg.handle.db.insert(t.agentVersions).values([
      { agentId: agent.id, version: 10, configJson: versionConfig({ system_prompt: 'v10 prompt' }) },
      { agentId: agent.id, version: 11, configJson: versionConfig({ system_prompt: 'v11 prompt' }) },
    ]);
    const app = await appWith();

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs/compare?a=${a.id}&b=${b.id}` });
    const body = EvalRunComparison.parse(res.json());
    expect(body.old_config?.system_prompt).toBe('v10 prompt');
    expect(body.new_config?.system_prompt).toBe('v11 prompt');
    expect(findKey(res.json(), 'actual_output')).toBe(false);
    expect(findKey(res.json(), 'findings')).toBe(false);

    // Delete one snapshot — that side degrades to null, the other stays.
    await pg.handle.db
      .delete(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agent.id), eq(t.agentVersions.version, 10)));
    const afterDelete = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs/compare?a=${a.id}&b=${b.id}` });
    const afterDeleteBody = EvalRunComparison.parse(afterDelete.json());
    expect(afterDeleteBody.old_config).toBeNull();
    expect(afterDeleteBody.new_config?.system_prompt).toBe('v11 prompt');
    await app.close();
  });

  it('AC-86: a snapshot that exists but fails AgentVersionConfig.parse degrades that side to null with a 200, not a 500', async () => {
    const agent = await createAgent();
    const a = await mkBatch(agent.id, new Date('2026-01-01T00:00:00Z'), { agentVersion: 20 });
    const b = await mkBatch(agent.id, new Date('2026-01-02T00:00:00Z'), { agentVersion: 21 });
    await pg.handle.db.insert(t.agentVersions).values([
      // Drifted: `provider` outside the enum — AgentVersionConfig.parse throws.
      { agentId: agent.id, version: 20, configJson: { ...versionConfig(), provider: 'not-a-real-provider' } },
      { agentId: agent.id, version: 21, configJson: versionConfig() },
    ]);
    const app = await appWith();

    const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-runs/compare?a=${a.id}&b=${b.id}` });
    expect(res.statusCode).toBe(200);
    const body = EvalRunComparison.parse(res.json());
    expect(body.old_config).toBeNull();
    expect(body.new_config).not.toBeNull();
    await app.close();
  });
});
