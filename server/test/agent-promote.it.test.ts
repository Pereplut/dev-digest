/**
 * POST /agents/:id/versions/:version/promote (spec 0020 AC-28 – AC-36,
 * AC-87, AC-88). Written against the Docker lane
 * (`pnpm exec vitest run .it.test`) — not run by the implementer, per
 * server/AGENTS.md's Docker-contention rule.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { EvalPromoteResult } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('POST /agents/:id/versions/:version/promote (spec 0020, Testcontainers pg)', () => {
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

  async function createSkill(enabled = true) {
    const [row] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name: `Skill-${randomUUID()}`,
        description: '',
        type: 'convention',
        source: 'manual',
        body: 'do the thing',
        enabled,
      })
      .returning();
    return row!;
  }

  async function link(agentId: string, skillId: string, order: number, enabled: boolean) {
    await pg.handle.db.insert(t.agentSkills).values({ agentId, skillId, order, enabled });
  }

  it('AC-28/AC-29/AC-36: promoting an older version restores its 7 config fields as a NEW version; name/description/enabled untouched', async () => {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Keep This Name',
        description: 'Keep this description',
        provider: 'openai',
        model: 'gpt-4o',
        systemPrompt: 'v3 prompt',
        outputSchema: null,
        strategy: 'map-reduce',
        ciFailOn: 'any',
        repoIntel: false,
        enabled: false,
        version: 3,
      })
      .returning();

    const v1Config = {
      provider: 'anthropic',
      model: 'claude-3-opus',
      system_prompt: 'v1 prompt',
      output_schema: { type: 'object' },
      strategy: 'single-pass',
      ci_fail_on: 'critical',
      repo_intel: true,
      skills: [] as string[],
    };
    await pg.handle.db.insert(t.agentVersions).values({ agentId: agent!.id, version: 1, configJson: v1Config });

    const app = await appWith();
    const res = await app.inject({ method: 'POST', url: `/agents/${agent!.id}/versions/1/promote` });
    expect(res.statusCode).toBe(200);
    const body = EvalPromoteResult.parse(res.json());
    expect(body.version).toBe(4);
    expect(body.agent.version).toBe(4);

    const [row] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.id, agent!.id));
    expect(row).toMatchObject({
      provider: 'anthropic',
      model: 'claude-3-opus',
      systemPrompt: 'v1 prompt',
      strategy: 'single-pass',
      ciFailOn: 'critical',
      repoIntel: true,
      version: 4,
      // AC-29 — untouched, although the config completely changed.
      name: 'Keep This Name',
      description: 'Keep this description',
      enabled: false,
    });
    expect(row!.outputSchema).toEqual({ type: 'object' });

    const [snapshot] = await pg.handle.db
      .select()
      .from(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agent!.id), eq(t.agentVersions.version, 4)));
    expect(snapshot).toBeDefined();
    expect((snapshot!.configJson as { system_prompt: string }).system_prompt).toBe('v1 prompt');
    await app.close();
  });

  it('AC-30/AC-31/AC-32: reconciles skill links — flips enabled on existing links, appends a newly-restored one after them, skips a deleted one', async () => {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name: 'Skilled Agent', provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'current', version: 2 })
      .returning();

    const skillA = await createSkill();
    const skillB = await createSkill();
    const skillC = await createSkill();
    const skillD = await createSkill();

    // Existing links BEFORE promote: A disabled, B enabled; C has no link row.
    await link(agent!.id, skillA.id, 0, false);
    await link(agent!.id, skillB.id, 1, true);

    const snapshotConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      system_prompt: 'v1 prompt',
      output_schema: null,
      strategy: 'single-pass',
      ci_fail_on: 'critical',
      repo_intel: true,
      skills: [skillA.id, skillC.id, skillD.id],
    };
    await pg.handle.db.insert(t.agentVersions).values({ agentId: agent!.id, version: 1, configJson: snapshotConfig });

    // D's skill row is deleted AFTER the snapshot was written — cascades its
    // (nonexistent, in this fixture) link row away too.
    await pg.handle.db.delete(t.skills).where(eq(t.skills.id, skillD.id));

    const app = await appWith();
    const res = await app.inject({ method: 'POST', url: `/agents/${agent!.id}/versions/1/promote` });
    expect(res.statusCode).toBe(200);
    const body = EvalPromoteResult.parse(res.json());
    expect(body.skills_not_restored).toEqual([skillD.id]);

    const links = await pg.handle.db
      .select()
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, agent!.id))
      .orderBy(t.agentSkills.order);
    const byId = new Map(links.map((l) => [l.skillId, l]));
    expect(byId.get(skillA.id)?.enabled).toBe(true); // A: in snapshot → enabled
    expect(byId.get(skillB.id)?.enabled).toBe(false); // B: NOT in snapshot → disabled
    expect(byId.get(skillC.id)?.enabled).toBe(true); // C: in snapshot, newly linked
    expect(byId.has(skillD.id)).toBe(false); // D: skipped, no row

    // C's new row sorts AFTER the pre-existing A/B links.
    const orderOf = (id: string) => links.find((l) => l.skillId === id)!.order;
    expect(orderOf(skillC.id)).toBeGreaterThan(orderOf(skillA.id));
    expect(orderOf(skillC.id)).toBeGreaterThan(orderOf(skillB.id));

    // The config fields still landed alongside the link reconciliation.
    const [row] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.id, agent!.id));
    expect(row!.systemPrompt).toBe('v1 prompt');
    await app.close();
  });

  it('AC-87/AC-88: a snapshot skill that still exists but is globally disabled is link-enabled AND reported in skills_not_restored; the union invariant holds, including the plain all-restored case', async () => {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name: 'Invariant Agent', provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'current', version: 2 })
      .returning();

    const skillA = await createSkill();
    const skillC = await createSkill();
    const skillD = await createSkill();
    const skillE = await createSkill(false); // globally disabled

    await link(agent!.id, skillA.id, 0, false);
    await link(agent!.id, skillE.id, 1, true);

    const snapshotConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      system_prompt: 'v0 prompt',
      output_schema: null,
      strategy: 'single-pass',
      ci_fail_on: 'critical',
      repo_intel: true,
      skills: [skillA.id, skillC.id, skillD.id, skillE.id],
    };
    await pg.handle.db.insert(t.agentVersions).values({ agentId: agent!.id, version: 1, configJson: snapshotConfig });
    await pg.handle.db.delete(t.skills).where(eq(t.skills.id, skillD.id));

    const app = await appWith();
    const res = await app.inject({ method: 'POST', url: `/agents/${agent!.id}/versions/1/promote` });
    expect(res.statusCode).toBe(200);
    const body = EvalPromoteResult.parse(res.json());

    expect(body.skills_not_restored.sort()).toEqual([skillD.id, skillE.id].sort());

    const eLink = (
      await pg.handle.db
        .select()
        .from(t.agentSkills)
        .where(and(eq(t.agentSkills.agentId, agent!.id), eq(t.agentSkills.skillId, skillE.id)))
    )[0];
    expect(eLink?.enabled).toBe(true); // link-enabled per AC-30/AC-31

    const newVersion = body.agent.version;
    const [newSnapshot] = await pg.handle.db
      .select()
      .from(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agent!.id), eq(t.agentVersions.version, newVersion)));
    const newSkills = (newSnapshot!.configJson as { skills: string[] }).skills;

    // AC-88: new snapshot's skills ∪ skills_not_restored == the PROMOTED snapshot's skills.
    const union = new Set([...newSkills, ...body.skills_not_restored]);
    expect(union).toEqual(new Set(snapshotConfig.skills));
    expect(newSkills).not.toContain(skillE.id); // excluded from the new snapshot itself

    // Plain case: a second agent whose snapshot skills are all still live and
    // enabled — the union equals the original and skills_not_restored is empty.
    const [plainAgent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name: 'Plain Agent', provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'current', version: 2 })
      .returning();
    const plainSkill = await createSkill();
    await link(plainAgent!.id, plainSkill.id, 0, true);
    const plainConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      system_prompt: 'v0',
      output_schema: null,
      strategy: 'single-pass',
      ci_fail_on: 'critical',
      repo_intel: true,
      skills: [plainSkill.id],
    };
    await pg.handle.db.insert(t.agentVersions).values({ agentId: plainAgent!.id, version: 1, configJson: plainConfig });
    const plainRes = await app.inject({ method: 'POST', url: `/agents/${plainAgent!.id}/versions/1/promote` });
    const plainBody = EvalPromoteResult.parse(plainRes.json());
    expect(plainBody.skills_not_restored).toEqual([]);
    const [plainSnapshot] = await pg.handle.db
      .select()
      .from(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, plainAgent!.id), eq(t.agentVersions.version, plainBody.agent.version)));
    expect((plainSnapshot!.configJson as { skills: string[] }).skills).toEqual(plainConfig.skills);

    await app.close();
  });

  it('AC-33: promoting the agent\'s current version is 409, and changes no row', async () => {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name: 'Current Version Agent', provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'x', version: 1 })
      .returning();

    const app = await appWith();
    const res = await app.inject({ method: 'POST', url: `/agents/${agent!.id}/versions/1/promote` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('conflict');

    const [row] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.id, agent!.id));
    expect(row!.version).toBe(1);
    await app.close();
  });

  it('AC-34: a queued/running batch for this agent is 409; once it is done, the same promote succeeds', async () => {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name: 'Live Batch Agent', provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'current', version: 2 })
      .returning();
    const snapshotConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      system_prompt: 'v1',
      output_schema: null,
      strategy: 'single-pass',
      ci_fail_on: 'critical',
      repo_intel: true,
      skills: [] as string[],
    };
    await pg.handle.db.insert(t.agentVersions).values({ agentId: agent!.id, version: 1, configJson: snapshotConfig });

    const [batch] = await pg.handle.db
      .insert(t.evalRunBatches)
      .values({ workspaceId, ownerKind: 'agent', ownerId: agent!.id, agentId: agent!.id, agentVersion: 2, casesTotal: 1, status: 'running' })
      .returning();

    const app = await appWith();
    const blocked = await app.inject({ method: 'POST', url: `/agents/${agent!.id}/versions/1/promote` });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('conflict');

    const [stillRow] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.id, agent!.id));
    expect(stillRow!.version).toBe(2);

    await pg.handle.db.update(t.evalRunBatches).set({ status: 'done' }).where(eq(t.evalRunBatches.id, batch!.id));
    const allowed = await app.inject({ method: 'POST', url: `/agents/${agent!.id}/versions/1/promote` });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it('AC-35: a :version with no agent_versions row is 404', async () => {
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({ workspaceId, name: 'No Snapshot Agent', provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'x', version: 1 })
      .returning();

    const app = await appWith();
    const res = await app.inject({ method: 'POST', url: `/agents/${agent!.id}/versions/99/promote` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
    await app.close();
  });
});
