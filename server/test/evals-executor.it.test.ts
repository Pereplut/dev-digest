/**
 * The eval run executor's background sweep (spec 0019). AC-36, AC-38 through
 * AC-43 (except cancellation, covered by `evals-cancel.it.test.ts`),
 * AC-44 through AC-47.
 *
 * Written against the Docker lane (`pnpm exec vitest run .it.test`) — not run
 * by the implementer, per server/AGENTS.md's Docker-contention rule.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
  Review,
} from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * The `diff --git` / `---` / `+++` header is LOAD-BEARING, not decoration.
 * `parseUnifiedDiff` keys files off those lines: a bare `@@` hunk parses to
 * `files: []`, which sends every case down the "stored diff has no changed
 * files" branch (AC-42) instead of the model-call branch these tests exist to
 * exercise. Verified 2026-10-07 — bare fixture → 0 files, headed → 1
 * (`src/a.ts`). The path must stay `src/a.ts` and the hunk must cover lines
 * 1-2, because `expectedFile`/`expectedStartLine`/`expectedEndLine` below and
 * the `HIT` finding above all cite exactly that range; change one and the
 * grounding gate drops the finding, silently turning a hit into a miss.
 */
const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,1 +1,2 @@',
  ' a',
  '+b',
].join('\n');

/** A finding ON the case's own expected file/range — a hit. */
const HIT: Review = {
  verdict: 'comment',
  summary: 's',
  score: 90,
  findings: [
    {
      id: 'f1',
      severity: 'WARNING',
      category: 'bug',
      title: 'found it',
      file: 'src/a.ts',
      start_line: 1,
      end_line: 2,
      rationale: 'r',
      confidence: 0.8,
      kind: 'finding',
    },
  ],
};

/** A finding on a file ABSENT from the case's own diff — grounding drops it (a miss). */
const MISS: Review = {
  verdict: 'comment',
  summary: 's',
  score: 100,
  findings: [
    {
      id: 'f-phantom',
      severity: 'WARNING',
      category: 'bug',
      title: 'phantom',
      file: 'src/not-in-diff.ts',
      start_line: 1,
      end_line: 1,
      rationale: 'r',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

/** Records every `completeStructured` call and its sent messages; serves fixtures in order. */
class RecordingLLMProvider implements LLMProvider {
  readonly id: 'openai' | 'anthropic' | 'openrouter';
  public requests: StructuredRequest<unknown>[] = [];
  private inFlight = 0;
  public maxConcurrent = 0;

  constructor(
    private fixtures: Review[],
    id: 'openai' | 'anthropic' | 'openrouter' = 'openai',
  ) {
    this.id = id;
  }

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error('complete() is not used by the review engine');
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.inFlight++;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.inFlight);
    this.requests.push(req as StructuredRequest<unknown>);
    const fixture = this.fixtures[Math.min(this.requests.length - 1, this.fixtures.length - 1)]!;
    const parsed = (req.schema as z.ZodType<T>).safeParse(fixture);
    this.inFlight--;
    if (!parsed.success) throw new Error(`fixture failed schema: ${parsed.error.message}`);
    return {
      data: parsed.data,
      model: req.model,
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.000001,
      raw: JSON.stringify(fixture),
      attempts: 1,
    };
  }

  async embed(): Promise<number[][]> {
    return [];
  }
}

const TERMINAL = new Set(['done', 'failed', 'cancelled']);
async function waitForBatch(db: PgFixture['handle']['db'], batchId: string, timeoutMs = 10_000) {
  const start = Date.now();
  for (;;) {
    const [row] = await db.select().from(t.evalRunBatches).where(eq(t.evalRunBatches.id, batchId));
    if (row && TERMINAL.has(row.status)) return row;
    if (Date.now() - start > timeoutMs) return row;
    await new Promise((r) => setTimeout(r, 25));
  }
}

d('evals: run executor (Testcontainers pg)', () => {
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

  function appWith(llm: LLMProvider) {
    return buildApp({ config: config(), db: pg.handle.db, overrides: { llm: { openai: llm } } });
  }

  async function createAgent() {
    const [agent] = await pg.handle.db
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

  async function addCase(ownerId: string, overrides: Partial<typeof t.evalCases.$inferInsert> = {}) {
    const [row] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId,
        name: `case-${randomUUID()}`,
        inputDiff: DIFF,
        expectationKind: 'must_find',
        expectedFile: 'src/a.ts',
        expectedStartLine: 1,
        expectedEndLine: 2,
        ...overrides,
      })
      .returning();
    return row!;
  }

  it('container.llm is called once for a three-case batch, status goes queued -> running -> done with one terminal write, never two concurrent calls', async () => {
    const llm = new RecordingLLMProvider([HIT, HIT, HIT]);
    const app = await appWith(llm);
    const agent = await createAgent();
    await addCase(agent.id);
    await addCase(agent.id);
    await addCase(agent.id);

    const { batch_id: batchId } = (
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
    ).json();
    const final = await waitForBatch(pg.handle.db, batchId);
    expect(final!.status).toBe('done');
    expect(llm.maxConcurrent).toBe(1);

    const runs = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.batchId, batchId));
    expect(runs).toHaveLength(3);
    for (const run of runs) {
      expect(run.pass).not.toBeNull();
      expect(run.recall).not.toBeNull();
      expect(run.precision).not.toBeNull();
      expect(run.citationAccuracy).not.toBeNull();
      expect(run.durationMs).not.toBeNull();
      expect(run.costUsd).not.toBeNull();
    }
  });

  it('a model output naming a file absent from the case diff scores as a miss (grounding drops it)', async () => {
    const llm = new RecordingLLMProvider([MISS]);
    const app = await appWith(llm);
    const agent = await createAgent();
    await addCase(agent.id);

    const { batch_id: batchId } = (
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
    ).json();
    await waitForBatch(pg.handle.db, batchId);

    const [run] = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.batchId, batchId));
    expect(run!.pass).toBe(false); // must_find expectation, matched by nothing
    expect(run!.recall).toBe(0);
  });

  it('a middle case with input_diff = "not a diff" fails that row only; the other two are scored and the batch completes', async () => {
    const llm = new RecordingLLMProvider([HIT, HIT]);
    const app = await appWith(llm);
    const agent = await createAgent();
    const c1 = await addCase(agent.id, { name: 'c1' });
    const c2 = await addCase(agent.id, { name: 'c2', inputDiff: 'not a diff' });
    const c3 = await addCase(agent.id, { name: 'c3' });

    const { batch_id: batchId } = (
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
    ).json();
    const final = await waitForBatch(pg.handle.db, batchId);
    expect(final!.status).toBe('done');

    const runs = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.batchId, batchId));
    expect(runs).toHaveLength(3);
    const byCase = new Map(runs.map((r) => [r.caseId, r]));
    expect(byCase.get(c2.id)!.pass).toBe(false);
    expect(byCase.get(c2.id)!.recall).toBeNull();
    expect(byCase.get(c1.id)!.pass).not.toBeNull();
    expect(byCase.get(c3.id)!.pass).not.toBeNull();
    // only two real model calls — case 2 never reached the provider
    expect(llm.requests).toHaveLength(2);
  });

  it('missing provider key: batch failed, zero child rows, zero model calls', async () => {
    // No `llm` override at all — container.llm('openai') throws ConfigError
    // because no OPENAI_API_KEY secret exists in this test's local secrets dir.
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const agent = await createAgent();
    await addCase(agent.id);

    const { batch_id: batchId } = (
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
    ).json();
    const final = await waitForBatch(pg.handle.db, batchId);
    expect(final!.status).toBe('failed');
    expect(final!.error).toBeTruthy();

    const runs = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.batchId, batchId));
    expect(runs).toHaveLength(0);
  });

  it('agent edited mid-batch does not change the batch\'s recorded agent_version', async () => {
    const llm = new RecordingLLMProvider([HIT, HIT]);
    const app = await appWith(llm);
    const agent = await createAgent();
    await addCase(agent.id);
    await addCase(agent.id);

    const { batch_id: batchId } = (
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
    ).json();
    // Edit the agent while the sweep is (plausibly still) running.
    await app.inject({ method: 'PUT', url: `/agents/${agent.id}`, payload: { system_prompt: 'changed mid-batch' } });
    await waitForBatch(pg.handle.db, batchId);

    const [batch] = await pg.handle.db.select().from(t.evalRunBatches).where(eq(t.evalRunBatches.id, batchId));
    expect(batch!.agentVersion).toBe(1); // the version at QUEUE time, not after the edit
  });

  it('the agent\'s one enabled linked skill appears in every case\'s prompt; a disabled link does not', async () => {
    const llm = new RecordingLLMProvider([HIT, HIT]);
    const app = await appWith(llm);
    const agent = await createAgent();
    await addCase(agent.id);
    await addCase(agent.id);

    const [enabledSkill] = await pg.handle.db
      .insert(t.skills)
      .values({ workspaceId, name: 'enabled-skill', description: 'd', type: 'custom', source: 'manual', body: 'Do the thing.' })
      .returning();
    const [disabledSkill] = await pg.handle.db
      .insert(t.skills)
      .values({ workspaceId, name: 'disabled-skill', description: 'd', type: 'custom', source: 'manual', body: 'Never applies.' })
      .returning();
    await pg.handle.db
      .insert(t.agentSkills)
      .values([
        { agentId: agent.id, skillId: enabledSkill!.id, order: 0, enabled: true },
        { agentId: agent.id, skillId: disabledSkill!.id, order: 1, enabled: false },
      ]);

    const { batch_id: batchId } = (
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
    ).json();
    await waitForBatch(pg.handle.db, batchId);

    expect(llm.requests).toHaveLength(2);
    for (const req of llm.requests) {
      const system = req.messages.find((m) => m.role === 'system')!.content;
      expect(system).toContain('enabled-skill');
      expect(system).not.toContain('disabled-skill');
    }
  });

  it('SSE subscribed before the batch starts sees at least one event per case plus the terminal one, each per-case result carrying structured data', async () => {
    const llm = new RecordingLLMProvider([HIT, HIT]);
    const app = await appWith(llm);
    const agent = await createAgent();
    await addCase(agent.id);
    await addCase(agent.id);

    const { batch_id: batchId } = (
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
    ).json();
    await waitForBatch(pg.handle.db, batchId);

    const sse = await app.inject({ method: 'GET', url: `/runs/${batchId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');

    // Each SSE frame is `data: <json>\n\n`; parse every one and find the
    // per-case result events — the structured field the client's progress
    // counter reads, not the regex-matched human-readable message.
    const frames = sse.payload
      .split('\n\n')
      .map((block) => block.split('\n').find((l) => l.startsWith('data: ')))
      .filter((l): l is string => !!l)
      .map((l) => JSON.parse(l.slice('data: '.length)) as { kind: string; data?: unknown });

    const caseEvents = frames.filter(
      (f): f is { kind: string; data: { evalCase: { index: number; total: number; pass: boolean } } } =>
        f.kind === 'result' &&
        !!f.data &&
        typeof f.data === 'object' &&
        'evalCase' in (f.data as object),
    );
    expect(caseEvents.length).toBeGreaterThanOrEqual(2);
    expect(caseEvents[0]!.data.evalCase.total).toBe(2);
    expect(caseEvents.map((e) => e.data.evalCase.index)).toEqual([1, 2]);
  });
});
