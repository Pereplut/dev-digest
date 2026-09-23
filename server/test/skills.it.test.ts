import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { zipSync, strToU8 } from 'fflate';
import type { ChatMessage, Review } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockEmbedder, MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { SkillsRepository } from '../src/modules/skills/repository/skill.repo.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[skills] Docker not available — skipping integration tests.');
}

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded secret.',
  score: 42,
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live key is committed.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;

/** Fail with the server's own payload instead of a property access on undefined (INSIGHTS 2026-09-18). */
function ok<T>(res: { statusCode: number; json: () => unknown; body: string }, status = 200): T {
  if (res.statusCode !== status) throw new Error(`expected ${status}, got ${res.statusCode}: ${res.body}`);
  return res.json() as T;
}

d('skills module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE })) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        llm: { openai: llm },
      },
    });
  }

  type App = Awaited<ReturnType<typeof makeApp>>;
  type SkillDto = { id: string; name: string; version: number; enabled: boolean; token_count: number; stats: { agent_count: number; pull_rate: number | null; accept_rate: number | null } };

  async function createSkill(app: App, overrides: Record<string, unknown> = {}): Promise<SkillDto> {
    const name = uniq('it-skill');
    return ok<SkillDto>(
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name,
          description: `desc of ${name}`,
          type: 'security',
          body: `BODY-${name}: flag hardcoded secrets.`,
          ...overrides,
        },
      }),
      201,
    );
  }

  async function createAgent(app: App): Promise<{ id: string }> {
    return ok(
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: uniq('it-agent'), provider: 'openai', model: 'gpt-4.1', system_prompt: 'You review.' },
      }),
      201,
    );
  }

  async function setupPr() {
    const db = pg.handle.db;
    const name = uniq('repo');
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 7,
        title: 'Add config',
        author: 'dev',
        branch: 'feat/x',
        base: 'main',
        headSha: 'abc1234',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return pr!;
  }

  // ---- CRUD + versions ------------------------------------------------------

  it('create → v1, content edit → v2 with note, enabled toggle does not version, restore → v3', async () => {
    const app = await makeApp();
    const s = await createSkill(app, { message: 'first' });
    expect(s.version).toBe(1);
    expect(s.token_count).toBeGreaterThan(0);
    expect(s.stats).toEqual({ agent_count: 0, pull_rate: null, accept_rate: null });

    const v2 = ok<SkillDto>(
      await app.inject({ method: 'PUT', url: `/skills/${s.id}`, payload: { body: 'Edited body.', message: 'tighten' } }),
    );
    expect(v2.version).toBe(2);

    const toggled = ok<SkillDto>(
      await app.inject({ method: 'PUT', url: `/skills/${s.id}`, payload: { enabled: false } }),
    );
    expect(toggled.version).toBe(2);
    expect(toggled.enabled).toBe(false);

    const versions = ok<{ version: number; message: string | null; body: string }[]>(
      await app.inject({ method: 'GET', url: `/skills/${s.id}/versions` }),
    );
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0]!.message).toBe('tighten');
    expect(versions[1]!.message).toBe('first');

    const restored = ok<SkillDto & { body: string }>(
      await app.inject({ method: 'POST', url: `/skills/${s.id}/versions/1/restore` }),
    );
    expect(restored.version).toBe(3);
    expect(restored.body).toBe(versions[1]!.body);
    const after = ok<{ version: number; message: string | null }[]>(
      await app.inject({ method: 'GET', url: `/skills/${s.id}/versions` }),
    );
    expect(after[0]).toMatchObject({ version: 3, message: 'Restored v1' });

    expect((await app.inject({ method: 'POST', url: `/skills/${s.id}/versions/99/restore` })).statusCode).toBe(404);

    // list + ?q filter
    const list = ok<SkillDto[]>(await app.inject({ method: 'GET', url: `/skills?q=${encodeURIComponent(s.name)}` }));
    expect(list.map((x) => x.id)).toEqual([s.id]);

    const del = await app.inject({ method: 'DELETE', url: `/skills/${s.id}` });
    expect(ok(del)).toEqual({ ok: true });
    expect((await app.inject({ method: 'GET', url: `/skills/${s.id}` })).statusCode).toBe(404);
    await app.close();
  });

  it('a duplicate name is a 409 on create and on rename', async () => {
    const app = await makeApp();
    const a = await createSkill(app);
    const b = await createSkill(app);
    const dup = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: a.name, description: 'x', type: 'custom', body: 'y' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('conflict');
    const rename = await app.inject({ method: 'PUT', url: `/skills/${b.id}`, payload: { name: a.name } });
    expect(rename.statusCode).toBe(409);
    await app.close();
  });

  // ---- agent links ----------------------------------------------------------

  it('PUT /agents/:id/skills replaces links in order; foreign skills are rejected atomically', async () => {
    const app = await makeApp();
    const agent = await createAgent(app);
    const s1 = await createSkill(app);
    const s2 = await createSkill(app);

    const links = ok<{ skill_id: string; order: number; enabled: boolean; skill: SkillDto }[]>(
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/skills`,
        payload: { skills: [{ skill_id: s2.id, enabled: true }, { skill_id: s1.id, enabled: false }] },
      }),
    );
    expect(links.map((l) => [l.skill_id, l.order, l.enabled])).toEqual([
      [s2.id, 0, true],
      [s1.id, 1, false],
    ]);
    expect(links[0]!.skill.token_count).toBeGreaterThan(0);

    // skill_count = enabled links whose skill is enabled
    const one = ok<{ skill_count: number }>(await app.inject({ method: 'GET', url: `/agents/${agent.id}` }));
    expect(one.skill_count).toBe(1);
    const all = ok<{ id: string; skill_count: number }[]>(await app.inject({ method: 'GET', url: '/agents' }));
    expect(all.find((x) => x.id === agent.id)!.skill_count).toBe(1);

    // A skill from another workspace → 422, and the existing links are untouched.
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: uniq('other') }).returning();
    const foreign = await new SkillsRepository(pg.handle.db).insert({
      workspaceId: otherWs!.id,
      name: 'foreign',
      description: 'd',
      type: 'custom',
      body: 'b',
      source: 'manual',
    });
    const bad = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/skills`,
      payload: { skills: [{ skill_id: s1.id, enabled: true }, { skill_id: foreign.id, enabled: true }] },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.details).toEqual({ skill_ids: [foreign.id] });
    const still = ok<{ skill_id: string }[]>(await app.inject({ method: 'GET', url: `/agents/${agent.id}/skills` }));
    expect(still.map((l) => l.skill_id)).toEqual([s2.id, s1.id]);

    // Unknown agent → 404
    const ghost = await app.inject({
      method: 'PUT',
      url: '/agents/00000000-0000-4000-8000-000000000000/skills',
      payload: { skills: [] },
    });
    expect(ghost.statusCode).toBe(404);

    // Agent version snapshots record the ordered ENABLED skill ids.
    await app.inject({ method: 'PUT', url: `/agents/${agent.id}`, payload: { model: 'gpt-4o' } });
    const versions = ok<{ version: number; config: { skills: string[] } }[]>(
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/versions` }),
    );
    expect(versions[0]!.config.skills).toEqual([s2.id]);

    // Clearing works.
    expect(ok(await app.inject({ method: 'PUT', url: `/agents/${agent.id}/skills`, payload: { skills: [] } }))).toEqual([]);
    await app.close();
  });

  // ---- executor + stats -----------------------------------------------------

  it('a run sends only enabled skills in the SYSTEM message, records run_skills + trace; stats follow', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await makeApp(llm);
    const agent = await createAgent(app);
    const on = await createSkill(app);
    const linkOff = await createSkill(app);
    const globalOff = await createSkill(app);
    ok(await app.inject({ method: 'PUT', url: `/skills/${globalOff.id}`, payload: { enabled: false } }));
    ok(
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/skills`,
        payload: {
          skills: [
            { skill_id: on.id, enabled: true },
            { skill_id: linkOff.id, enabled: false },
            { skill_id: globalOff.id, enabled: true },
          ],
        },
      }),
    );

    const pr = await setupPr();
    const run1 = ok<{ runs: { run_id: string }[] }>(
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } }),
    );
    const runs = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    expect(runs[0]!.status).toBe('done');
    const runId = run1.runs[0]!.run_id;

    // A review now makes TWO structured calls: the intent classifier runs first
    // (spec 0008), then the review itself. Select by schema rather than by
    // order, so adding another pre-review call cannot silently re-point this.
    const call = llm.calls.find(
      (c) =>
        c.method === 'completeStructured' &&
        (c.req as { schemaName?: string }).schemaName !== 'IntentClassification',
    )!;
    const messages = (call.req as { messages: ChatMessage[] }).messages;
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain(`### Skill: ${on.name}`);
    expect(messages[0]!.content).toContain(`BODY-${on.name}`);
    expect(messages[1]!.content).not.toContain(`BODY-${on.name}`);
    for (const absent of [linkOff, globalOff]) {
      expect(messages.map((m) => m.content).join('\n')).not.toContain(`BODY-${absent.name}`);
    }

    const rs = await pg.handle.db.select().from(t.runSkills).where(eq(t.runSkills.runId, runId));
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ order: 0, skillId: on.id, skillName: on.name, version: 1 });
    expect(rs[0]!.tokens).toBe(on.token_count);

    const trace = ok<{
      skills_used: { id: string; name: string; version: number; tokens: number }[];
      prompt_tokens: Record<string, number>;
      prompt_assembly: { skills: string | null; system: string };
      log: { msg: string }[];
    }>(await app.inject({ method: 'GET', url: `/runs/${runId}/trace` }));
    expect(trace.skills_used).toEqual([{ id: on.id, name: on.name, version: 1, tokens: on.token_count }]);
    expect(trace.prompt_tokens.skills).toBeGreaterThan(0);
    expect(trace.prompt_tokens.system).toBeGreaterThan(0);
    expect(trace.prompt_tokens.user).toBeGreaterThan(0);
    expect(trace.prompt_assembly.skills).toContain(`### Skill: ${on.name}`);
    expect(trace.prompt_assembly.system).not.toContain('### Skill:');
    expect(trace.log.some((l) => l.msg === `Skills: 1 loaded (${on.name} v1)`)).toBe(true);

    // Accept the run's finding → accept rate 1.
    const reviews = ok<{ findings: { id: string }[] }[]>(await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` }));
    ok(await app.inject({ method: 'POST', url: `/findings/${reviews[0]!.findings[0]!.id}/accept` }));

    // Second run with the skill switched off on the link: the agent stays
    // linked (denominator 2) but the skill is not pulled (numerator 1).
    ok(
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/skills`,
        payload: { skills: [{ skill_id: on.id, enabled: false }] },
      }),
    );
    ok(await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } }));
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });
    const runs2 = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.prId, pr.id), eq(t.agentRuns.status, 'done')));
    expect(runs2).toHaveLength(2);
    const lastCall = llm.calls
      .filter(
        (c) =>
          c.method === 'completeStructured' &&
          (c.req as { schemaName?: string }).schemaName !== 'IntentClassification',
      )
      .at(-1)!;
    expect((lastCall.req as { messages: ChatMessage[] }).messages[0]!.content).not.toContain('### Skill:');

    const stats = ok<{
      agent_count: number;
      pull_rate: number | null;
      accept_rate: number | null;
      findings_30d: number;
      agents: { id: string }[];
      findings_by_category: { category: string; count: number }[];
    }>(await app.inject({ method: 'GET', url: `/skills/${on.id}/stats` }));
    expect(stats).toEqual({
      agent_count: 0,
      pull_rate: 0.5,
      accept_rate: 1,
      findings_30d: 1,
      agents: [],
      findings_by_category: [{ category: 'security', count: 1 }],
    });

    // Card stats on list/get agree with the Stats tab.
    const card = ok<SkillDto>(await app.inject({ method: 'GET', url: `/skills/${on.id}` }));
    expect(card.stats).toEqual({ agent_count: 0, pull_rate: 0.5, accept_rate: 1 });
    const listed = ok<SkillDto[]>(await app.inject({ method: 'GET', url: '/skills' })).find((x) => x.id === on.id)!;
    expect(listed.stats).toEqual(card.stats);

    // Deleting the skill keeps run history (skill_id → null, name kept).
    ok(await app.inject({ method: 'DELETE', url: `/skills/${on.id}` }));
    const [kept] = await pg.handle.db.select().from(t.runSkills).where(eq(t.runSkills.runId, runId));
    expect(kept).toMatchObject({ skillId: null, skillName: on.name });
    await app.close();
  });

  it('a run that fails after loading skills still records them in its trace', async () => {
    // A fixture that fails the Review schema makes the LLM call throw.
    const app = await makeApp(new MockLLMProvider('openai', { structured: { nope: true } }));
    const agent = await createAgent(app);
    const s = await createSkill(app);
    ok(
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}/skills`,
        payload: { skills: [{ skill_id: s.id, enabled: true }] },
      }),
    );
    const pr = await setupPr();
    const res = ok<{ runs: { run_id: string }[] }>(
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } }),
    );
    const [run] = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    expect(run!.status).toBe('failed');
    const trace = ok<{
      skills_used: { id: string }[];
      prompt_assembly: { skills: string | null };
      prompt_tokens: Record<string, number>;
    }>(await app.inject({ method: 'GET', url: `/runs/${res.runs[0]!.run_id}/trace` }));
    expect(trace.skills_used.map((x) => x.id)).toEqual([s.id]);
    expect(trace.prompt_assembly.skills).toBe(`## Skills\n### Skill: ${s.name}\nBODY-${s.name}: flag hardcoded secrets.`);
    expect(trace.prompt_tokens.skills).toBeGreaterThan(0);
    // A failed run writes no run_skills rows (the persistence transaction never ran).
    expect(await pg.handle.db.select().from(t.runSkills).where(eq(t.runSkills.runId, res.runs[0]!.run_id))).toEqual([]);
    await app.close();
  });

  it('stats with no data: rates are null', async () => {
    const app = await makeApp();
    const s = await createSkill(app);
    const stats = ok(await app.inject({ method: 'GET', url: `/skills/${s.id}/stats` }));
    expect(stats).toEqual({
      agent_count: 0,
      pull_rate: null,
      accept_rate: null,
      findings_30d: 0,
      agents: [],
      findings_by_category: [],
    });
    await app.close();
  });

  // ---- import preview -------------------------------------------------------

  it('import preview parses a zip, flags scripts and name conflicts, and persists nothing', async () => {
    const app = await makeApp();
    const existing = await createSkill(app);
    const zip = zipSync({
      'SKILL.md': strToU8(`---\nname: ${existing.name}\ndescription: >-\n  Folded\n  description.\n---\nBody.`),
      'scripts/detect.sh': strToU8('#!/bin/sh\necho hi\n'),
    });
    const boundary = '----it-boundary';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="flaky.zip"\r\n` +
          'Content-Type: application/zip\r\n\r\n',
      ),
      Buffer.from(zip),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const countSkills = async () => (await pg.handle.db.select({ id: t.skills.id }).from(t.skills)).length;
    const countVersions = async () => (await pg.handle.db.select().from(t.skillVersions)).length;
    const before = [await countSkills(), await countVersions()];

    const preview = ok<{
      draft: { name: string; description: string; body: string };
      source_filename: string;
      ignored_files: { path: string; reason: string }[];
      name_conflict: boolean;
    }>(
      await app.inject({
        method: 'POST',
        url: '/skills/import/preview',
        payload,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      }),
    );
    expect(preview).toEqual({
      draft: { name: existing.name, description: 'Folded description.', type: 'custom', body: 'Body.' },
      source_filename: 'flaky.zip',
      ignored_files: [{ path: 'scripts/detect.sh', reason: 'executable — not processed' }],
      name_conflict: true,
    });
    expect([await countSkills(), await countVersions()]).toEqual(before);

    // Confirming = a normal create with source imported_file.
    const saved = ok<{ source: string }>(
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { ...preview.draft, name: uniq('imported'), source: 'imported_file' },
      }),
      201,
    );
    expect(saved.source).toBe('imported_file');
    await app.close();
  });
});
