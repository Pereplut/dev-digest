/**
 * POST /eval-runs/:batchId/cancel (spec 0019). AC-69, AC-70, AC-71.
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
import type { Container } from '../src/platform/container.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * The header is load-bearing: `parseUnifiedDiff` keys files off `diff --git` /
 * `---` / `+++`, not off `@@`, so a bare hunk parses to `files: []`. Without it
 * every case short-circuits on "no changed files", the LLM is never called, and
 * `waitFor(() => llm.requests.length >= 1)` below times out — which is exactly
 * how this suite failed on its first real run. See `server/INSIGHTS.md` (2026-10-07).
 */
const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,1 +1,2 @@',
  ' a',
  '+b',
].join('\n');

const HIT: Review = {
  verdict: 'comment',
  summary: 's',
  score: 100,
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

/**
 * A fake provider that BLOCKS each `completeStructured` call until the test
 * explicitly `release()`s it — the deterministic way to put a case "in
 * flight" so a cancel can be issued before the next case would ever start.
 * Deliberately does not honour `signal` — unlike OpenRouter, exercising the
 * documented limit (C11): the loop stops between cases, an in-flight call is
 * not guaranteed to be aborted.
 */
class GatedLLMProvider implements LLMProvider {
  readonly id: 'openai' | 'anthropic' | 'openrouter' = 'openai';
  public requests: StructuredRequest<unknown>[] = [];
  private gates: { resolve: () => void; promise: Promise<void> }[] = [];

  constructor(private fixtures: Review[]) {}

  private gateFor(n: number) {
    if (!this.gates[n]) {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => (resolve = r));
      this.gates[n] = { resolve, promise };
    }
    return this.gates[n]!;
  }

  /** Let call N (0-based) proceed to resolve. */
  release(n: number): void {
    this.gateFor(n).resolve();
  }

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }

  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error('complete() is not used by the review engine');
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const n = this.requests.length;
    this.requests.push(req as StructuredRequest<unknown>);
    await this.gateFor(n).promise;
    const fixture = this.fixtures[Math.min(n, this.fixtures.length - 1)]!;
    const parsed = (req.schema as z.ZodType<T>).safeParse(fixture);
    if (!parsed.success) throw new Error(`fixture failed schema: ${parsed.error.message}`);
    return {
      data: parsed.data,
      model: req.model,
      tokensIn: 1,
      tokensOut: 1,
      costUsd: 0.000001,
      raw: '',
      attempts: 1,
    };
  }

  async embed(): Promise<number[][]> {
    return [];
  }
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const TERMINAL = new Set(['done', 'failed', 'cancelled']);
async function waitForBatch(db: PgFixture['handle']['db'], batchId: string, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const [row] = await db.select().from(t.evalRunBatches).where(eq(t.evalRunBatches.id, batchId));
    if (row && TERMINAL.has(row.status)) return row;
    if (Date.now() - start > timeoutMs) return row;
    await new Promise((r) => setTimeout(r, 10));
  }
}

d('evals: cancel (Testcontainers pg)', () => {
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

  async function addCase(ownerId: string) {
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
      })
      .returning();
    return row!;
  }

  it('cancel after case 1 starts: 200, the registered controller is aborted, the provider call count stays at 1, status cancelled, the one row intact', async () => {
    const llm = new GatedLLMProvider([HIT, HIT, HIT]);
    const app = await appWith(llm);
    const agent = await createAgent();
    await addCase(agent.id);
    await addCase(agent.id);
    await addCase(agent.id);

    const { batch_id: batchId } = (
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
    ).json();

    await waitFor(() => llm.requests.length >= 1);

    const cancelRes = await app.inject({ method: 'POST', url: `/eval-runs/${batchId}/cancel` });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json()).toEqual({ ok: true });
    expect((app as unknown as { container: Container }).container.runBus.isCancelled(batchId)).toBe(true);

    // The fake provider does not honour `signal`, so case 1 still completes
    // normally — the cancellation is observed at the NEXT per-case checkpoint.
    llm.release(0);

    const final = await waitForBatch(pg.handle.db, batchId);
    expect(final?.status).toBe('cancelled');
    expect(llm.requests).toHaveLength(1); // cases two and three never started

    const runs = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.batchId, batchId));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.pass).not.toBeNull(); // case 1 completed and scored normally
  });

  it('cancelling a terminal batch is a 409 conflict and leaves the row byte-identical', async () => {
    const llm = new GatedLLMProvider([HIT]);
    const app = await appWith(llm);
    const agent = await createAgent();
    await addCase(agent.id);

    const { batch_id: batchId } = (
      await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` })
    ).json();
    await waitFor(() => llm.requests.length >= 1);
    llm.release(0);
    await waitForBatch(pg.handle.db, batchId);

    const [before] = await pg.handle.db.select().from(t.evalRunBatches).where(eq(t.evalRunBatches.id, batchId));
    expect(before!.status).toBe('done');

    const res = await app.inject({ method: 'POST', url: `/eval-runs/${batchId}/cancel` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('conflict');

    const [after] = await pg.handle.db.select().from(t.evalRunBatches).where(eq(t.evalRunBatches.id, batchId));
    expect(after).toEqual(before);
  });
});
