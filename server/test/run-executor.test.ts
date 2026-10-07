/**
 * EvalRunExecutor — hermetic regression tests for the "an unexpected throw
 * strands the batch in `running` forever" defect found by `/code-review`
 * against `run-executor.ts:64` (the outer `try` had a `finally` but no
 * `catch`).
 *
 * No DB, no HTTP: `Container`/`EvalBatchRepository` are real instances with
 * only the methods this path touches monkey-patched, following
 * `run-executor-cancel.test.ts`'s pattern for `ReviewRunExecutor`. Anything
 * that genuinely needs Postgres belongs in `evals-executor.it.test.ts`
 * (Docker lane, not run here).
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { LLMProvider, Review, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { Container, type ContainerOverrides } from '../src/platform/container.js';
import { SkillsRepository } from '../src/modules/skills/repository/skill.repo.js';
import {
  EvalBatchRepository,
  type CompleteTerminalValues,
  type InsertCaseRunValues,
} from '../src/modules/evals/repository/eval-batch.repo.js';
import { EvalRunExecutor, type EvalRunJob } from '../src/modules/evals/run-executor.js';
import type { AppConfig } from '../src/platform/config.js';
import type { Db, DbOrTx } from '../src/db/client.js';
import type { AgentRow, EvalCaseRow, EvalRunRow } from '../src/db/rows.js';

const UNUSED_DB = null as unknown as Db;

function testConfig(): AppConfig {
  return {
    databaseUrl: 'postgres://unused',
    apiPort: 0,
    apiHost: '127.0.0.1',
    webPort: 0,
    cloneDir: '/tmp/unused',
    secretsPath: '/tmp/unused-secrets.json',
    nodeEnv: 'test',
    logLevel: 'silent',
    webOrigin: 'http://localhost:0',
    embeddingsEnabled: false,
    repoIntelEnabled: false,
    promptLogVerbose: false,
    promptLogVerboseIgnored: false,
    promptLogEnabled: false,
  };
}

function agentFixture(over: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'General',
    description: '',
    provider: 'openai',
    model: 'gpt-4.1',
    systemPrompt: 's',
    outputSchema: null,
    strategy: 'single-pass',
    ciFailOn: 'critical',
    repoIntel: false,
    enabled: true,
    version: 1,
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

/** A diff with real `diff --git`/`+++` headers, so `parseUnifiedDiff` finds one file. */
const REAL_DIFF = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1,1 +1,2 @@', ' a', '+b'].join('\n');

function caseFixture(over: Partial<EvalCaseRow> = {}): EvalCaseRow {
  return {
    id: randomUUID(),
    workspaceId: 'ws-1',
    ownerKind: 'agent',
    ownerId: 'agent-1',
    name: 'case',
    inputDiff: REAL_DIFF,
    inputFiles: null,
    inputMeta: null,
    expectedOutput: null,
    notes: null,
    expectationKind: 'must_find',
    expectedFile: 'src/a.ts',
    expectedStartLine: 1,
    expectedEndLine: 2,
    sourceFindingId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

/** A finding on the case's own expected file/range — a hit (scores `pass: true`). */
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

/** Always returns `fixture`, regardless of how many cases are swept. */
function stubLlm(fixture: Review = HIT): LLMProvider {
  return {
    id: 'openai',
    async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      const parsed = (req.schema as { safeParse: (v: unknown) => { success: boolean; data?: T } }).safeParse(
        fixture,
      );
      if (!parsed.success || parsed.data === undefined) throw new Error('fixture failed schema');
      return {
        data: parsed.data,
        model: req.model,
        tokensIn: 10,
        tokensOut: 5,
        costUsd: 0.000001,
        raw: JSON.stringify(fixture),
        attempts: 1,
      };
    },
    async listModels() {
      return [];
    },
    async complete() {
      throw new Error('complete() is not used by the review engine');
    },
    async embed() {
      return [];
    },
  };
}

/** A `SkillsRepository` whose only touched method returns no skills, unless overridden. */
function makeSkillsRepo(enabledForAgent?: SkillsRepository['enabledForAgent']): SkillsRepository {
  const repo = new SkillsRepository(UNUSED_DB);
  repo.enabledForAgent = enabledForAgent ?? (async () => []);
  return repo;
}

class TestContainer extends Container {
  constructor(
    private readonly stubSkillsRepo: SkillsRepository,
    overrides: ContainerOverrides,
  ) {
    super(testConfig(), UNUSED_DB, overrides);
  }
  override get skillsRepo(): SkillsRepository {
    return this.stubSkillsRepo;
  }
}

interface BatchRepoCalls {
  markRunning: string[];
  failImmediately: { id: string; error: string }[];
  completeTerminal: { id: string; values: CompleteTerminalValues }[];
  insertCaseRun: InsertCaseRunValues[];
}

interface BatchRepoStubs {
  failImmediately?: EvalBatchRepository['failImmediately'];
  completeTerminal?: EvalBatchRepository['completeTerminal'];
  insertCaseRun?: EvalBatchRepository['insertCaseRun'];
}

/** A real `EvalBatchRepository` instance with every write recorded, and any
 *  method the test names replaced with its own behaviour (e.g. "always throw
 *  for this caseId", simulating a 23503 FK violation against a deleted case). */
function makeBatchRepo(stubs: BatchRepoStubs = {}): { repo: EvalBatchRepository; calls: BatchRepoCalls } {
  const repo = new EvalBatchRepository(UNUSED_DB);
  const calls: BatchRepoCalls = {
    markRunning: [],
    failImmediately: [],
    completeTerminal: [],
    insertCaseRun: [],
  };
  repo.markRunning = async (id) => {
    calls.markRunning.push(id);
  };
  repo.failImmediately =
    stubs.failImmediately ??
    (async (id, error) => {
      calls.failImmediately.push({ id, error });
    });
  repo.completeTerminal =
    stubs.completeTerminal ??
    (async (id, values) => {
      calls.completeTerminal.push({ id, values });
    });
  const defaultInsert = async (values: InsertCaseRunValues): Promise<EvalRunRow> => ({
    id: randomUUID(),
    caseId: values.caseId,
    batchId: values.batchId,
    ranAt: new Date(),
    actualOutput: values.actualOutput as object | null,
    pass: values.pass,
    recall: values.recall,
    precision: values.precision,
    citationAccuracy: values.citationAccuracy,
    durationMs: values.durationMs,
    costUsd: values.costUsd == null ? null : String(values.costUsd),
  });
  // Every attempt is recorded BEFORE delegating, including ones that go on to
  // throw — a test asserting "insertCaseRun was retried for the dead caseId"
  // needs the throwing attempt on the list too.
  const insert = stubs.insertCaseRun ?? defaultInsert;
  repo.insertCaseRun = async (values) => {
    calls.insertCaseRun.push(values);
    return insert(values);
  };
  return { repo, calls };
}

function job(over: Partial<EvalRunJob> = {}): EvalRunJob {
  return {
    batchId: randomUUID(),
    workspaceId: 'ws-1',
    agent: agentFixture(),
    cases: [caseFixture()],
    ...over,
  };
}

describe('EvalRunExecutor — outer catch-all (Fix 1: an unexpected throw must not strand the batch in `running`)', () => {
  it('skillsRepo.enabledForAgent throwing after markRunning still writes a terminal `failed` row with a non-empty error', async () => {
    const container = new TestContainer(
      makeSkillsRepo(async () => {
        throw new Error('skills lookup exploded');
      }),
      { llm: { openai: stubLlm() } },
    );
    const { repo, calls } = makeBatchRepo();
    const executor = new EvalRunExecutor(container, repo);
    const theJob = job();

    await expect(executor.run(theJob)).resolves.toBeUndefined();

    expect(calls.markRunning).toEqual([theJob.batchId]);
    expect(calls.completeTerminal).toHaveLength(0);
    expect(calls.failImmediately).toHaveLength(1);
    expect(calls.failImmediately[0]!.id).toBe(theJob.batchId);
    expect(calls.failImmediately[0]!.error).toContain('skills lookup exploded');
  });

  it('completeTerminal itself throwing (e.g. a dropped DB connection on the final write) still ends in a terminal `failed` row via the catch-all, not `running` forever', async () => {
    const container = new TestContainer(makeSkillsRepo(), { llm: { openai: stubLlm() } });
    const { repo, calls } = makeBatchRepo({
      completeTerminal: async () => {
        throw new Error('connection terminated unexpectedly');
      },
    });
    const executor = new EvalRunExecutor(container, repo);
    const theJob = job();

    await expect(executor.run(theJob)).resolves.toBeUndefined();

    expect(calls.failImmediately).toHaveLength(1);
    expect(calls.failImmediately[0]!.id).toBe(theJob.batchId);
    expect(calls.failImmediately[0]!.error).toContain('connection terminated unexpectedly');
  });

  it('failImmediately ALSO throwing inside the catch-all does not propagate — the run still settles instead of becoming an unhandled rejection', async () => {
    const container = new TestContainer(
      makeSkillsRepo(async () => {
        throw new Error('skills lookup exploded');
      }),
      { llm: { openai: stubLlm() } },
    );
    const { repo } = makeBatchRepo({
      failImmediately: async () => {
        throw new Error('db is down too');
      },
    });
    const executor = new EvalRunExecutor(container, repo);

    await expect(executor.run(job())).resolves.toBeUndefined();
  });
});

describe('EvalRunExecutor — per-case insertCaseRun failure must not be fatal to the sweep (the DELETE /eval-cases/:id race)', () => {
  it('a case deleted mid-sweep (insertCaseRun FK-violates on every attempt for that case) does not strand the batch; the other case is still scored and the batch reaches `done`', async () => {
    const container = new TestContainer(makeSkillsRepo(), { llm: { openai: stubLlm(HIT) } });
    const deletedCase = caseFixture({ name: 'deleted-mid-sweep' });
    const survivingCase = caseFixture({ name: 'still-there' });

    const { repo, calls } = makeBatchRepo({
      insertCaseRun: async (values): Promise<EvalRunRow> => {
        if (values.caseId === deletedCase.id) {
          const err = new Error('insert or update on table "eval_runs" violates foreign key constraint');
          (err as Error & { code?: string }).code = '23503';
          throw err;
        }
        return {
          id: randomUUID(),
          caseId: values.caseId,
          batchId: values.batchId,
          ranAt: new Date(),
          actualOutput: values.actualOutput as object | null,
          pass: values.pass,
          recall: values.recall,
          precision: values.precision,
          citationAccuracy: values.citationAccuracy,
          durationMs: values.durationMs,
          costUsd: values.costUsd == null ? null : String(values.costUsd),
        } satisfies EvalRunRow;
      },
    });
    const executor = new EvalRunExecutor(container, repo);
    const theJob = job({ cases: [deletedCase, survivingCase] });

    await expect(executor.run(theJob)).resolves.toBeUndefined();

    // Both the success-path insert (for the deleted case) AND the per-case
    // catch's retry attempted it — both FK-violated and were swallowed. The
    // surviving case's insert succeeded (one call recorded for it).
    const deletedAttempts = calls.insertCaseRun.filter((v) => v.caseId === deletedCase.id);
    expect(deletedAttempts.length).toBeGreaterThanOrEqual(2);
    const survivingAttempts = calls.insertCaseRun.filter((v) => v.caseId === survivingCase.id);
    expect(survivingAttempts).toHaveLength(1);

    // The sweep still reached its ONE terminal write, not stranded.
    expect(calls.completeTerminal).toHaveLength(1);
    expect(calls.completeTerminal[0]!.id).toBe(theJob.batchId);
    expect(calls.completeTerminal[0]!.values.status).toBe('done');
  });
});

/**
 * `EvalBatchRepository.completeTerminal`/`failImmediately` — both now scope
 * their UPDATE to a still-"live" (`queued`/`running`) row (AC-44: a batch
 * reaches exactly one terminal status). A fake `db` applies the REAL
 * `and(eq(id), inArray(status, LIVE_STATUSES))` predicate the repository
 * methods build — compiled to params via drizzle's own `PgDialect` — against
 * an in-memory row, so this pins the actual WHERE clause, not a
 * reimplementation of it, with no Postgres connection at all.
 */
function makeGuardedFakeDb(initialStatus: string): { db: DbOrTx; row: { id: string; status: string } } {
  const dialect = new PgDialect();
  const row = { id: 'batch-1', status: initialStatus };
  const fakeDb = {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (cond: SQL) => {
          // The repo always builds `and(eq(evalRunBatches.id, id), inArray(evalRunBatches.status, LIVE_STATUSES))`
          // — params compile to `[id, ...liveStatuses]` regardless of column order inside `and`.
          const { params } = dialect.sqlToQuery(cond);
          const [targetId, ...liveStatuses] = params as string[];
          if (row.id === targetId && liveStatuses.includes(row.status)) {
            Object.assign(row, values);
          }
          return Promise.resolve([]);
        },
      }),
    }),
  };
  return { db: fakeDb as unknown as DbOrTx, row };
}

describe('EvalBatchRepository — terminal-write guard (Fix 3: a terminal batch must not be overwritten)', () => {
  it('failImmediately called AFTER completeTerminal already wrote `done` is a no-op: the row stays `done`, not `failed`', async () => {
    const { db, row } = makeGuardedFakeDb('running');
    const repo = new EvalBatchRepository(db);

    await repo.completeTerminal('batch-1', {
      status: 'done',
      error: null,
      recall: 1,
      precision: 1,
      citationAccuracy: 1,
      casesPassed: 1,
      durationMs: 10,
      costUsd: null,
    } satisfies CompleteTerminalValues);
    expect(row.status).toBe('done');

    // Models the executor's catch-all firing because something (e.g.
    // `runLog.result`) threw right after `completeTerminal` landed.
    await repo.failImmediately('batch-1', 'thrown after completeTerminal');
    expect(row.status).toBe('done');
  });

  it('failImmediately DOES apply while the row is still live — the guard only blocks a SECOND terminal write', async () => {
    const { db, row } = makeGuardedFakeDb('running');
    const repo = new EvalBatchRepository(db);

    await repo.failImmediately('batch-1', 'provider resolution failed');
    expect(row.status).toBe('failed');
  });
});
