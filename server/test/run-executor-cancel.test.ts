/**
 * ReviewRunExecutor — real cancellation.
 *
 * server/INSIGHTS.md (2026-09-27): "The OpenRouter review path has no enforced
 * timeout, and cancelling a run does not abort it" — `POST /runs/:id/cancel`
 * only flipped a DB row and set a flag the executor checks BETWEEN map-reduce
 * files; a single-pass review (the common case) never reaches that checkpoint,
 * and a chunk already in flight ran to completion regardless. This suite
 * pins the fix: `RunBus.registerAbort` gives the executor's `AbortController`
 * to the bus, `cancel()` aborts it immediately, and the executor maps an
 * aborted call onto the SAME `status: 'cancelled'` path as `RunCancelledError`
 * — never `'failed'`.
 *
 * Hermetic: no DB, no HTTP. `Container`/`ReviewRepository`/`SkillsRepository`
 * are REAL instances with only the methods this path touches monkey-patched
 * (server/INSIGHTS.md, 2026-09-18: an `as unknown as` cast hides a missing
 * dependency at runtime while typecheck stays green — the pattern here follows
 * `blast-service.test.ts`'s real-subclass approach instead). `container.runBus`
 * is the app's actual singleton (Container assigns it unconditionally, with no
 * override slot), so tests use unique run ids rather than a fresh bus.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { LLMProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { Container, type ContainerOverrides } from '../src/platform/container.js';
import { ReviewRepository, type PullRow } from '../src/modules/reviews/repository.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { SkillsRepository } from '../src/modules/skills/repository/skill.repo.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import { MockGitClient } from '../src/adapters/mocks.js';
import { runBus } from '../src/platform/sse.js';
import type { AppConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import type { AgentRow } from '../src/db/rows.js';
import * as schema from '../src/db/schema.js';

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

function pull(over: Partial<PullRow> = {}): PullRow {
  return {
    id: 'pr-1',
    workspaceId: 'ws-1',
    repoId: 'repo-1',
    number: 42,
    title: 'Add rate limiting',
    author: 'marisa.koch',
    branch: 'feat/rl',
    base: 'main',
    headSha: 'deadbeef',
    lastReviewedSha: null,
    additions: 1,
    deletions: 0,
    filesCount: 1,
    status: 'needs_review',
    body: null,
    openedAt: null,
    updatedAt: null,
    ...over,
  };
}

function repoRow(over: Partial<typeof schema.repos.$inferSelect> = {}): typeof schema.repos.$inferSelect {
  return {
    id: 'repo-1',
    workspaceId: 'ws-1',
    owner: 'acme',
    name: 'widgets',
    fullName: 'acme/widgets',
    defaultBranch: 'main',
    clonePath: null,
    lastPolledAt: null,
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
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
    // Off, so the run touches nothing else in repoIntel — this suite is about
    // cancellation, not enrichment.
    repoIntel: false,
    enabled: true,
    version: 1,
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

/** A SkillsRepository whose only touched method returns no skills. */
function makeSkillsRepo(): SkillsRepository {
  const repo = new SkillsRepository(UNUSED_DB);
  repo.enabledForAgent = async () => [];
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

/** A ReviewRepository with only the two writes this path reaches stubbed, and
 *  every completeAgentRun call recorded for assertions. */
function makeReviewRepo() {
  const repo = new ReviewRepository(UNUSED_DB);
  const completed: { runId: string; values: Parameters<ReviewRepository['completeAgentRun']>[1] }[] = [];
  repo.completeAgentRun = async (runId, values) => {
    completed.push({ runId, values });
  };
  repo.saveRunTrace = async () => undefined;
  return { repo, completed };
}

function buildExecutor(llm: LLMProvider): { executor: ReviewRunExecutor; completed: ReturnType<typeof makeReviewRepo>['completed'] } {
  const container = new TestContainer(makeSkillsRepo(), {
    git: new MockGitClient(),
    llm: { openai: llm },
  });
  const { repo, completed } = makeReviewRepo();
  const executor = new ReviewRunExecutor(container, repo, new AgentsRepository(UNUSED_DB));
  return { executor, completed };
}

describe('ReviewRunExecutor — real cancellation of an in-flight LLM call', () => {
  it('aborts the request the instant cancel() fires mid-call, and persists status: cancelled', async () => {
    const runId = randomUUID();
    let seenSignal: AbortSignal | undefined;
    let abortedWhileStillInsideTheCall = false;

    const llm: LLMProvider = {
      id: 'openai',
      async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
        seenSignal = req.signal;
        // Simulates POST /runs/:id/cancel arriving while this HTTP request is
        // still in flight — the exact race the fix closes.
        runBus.cancel(runId);
        abortedWhileStillInsideTheCall = seenSignal?.aborted ?? false;
        // Simulates the provider's HTTP client rejecting on abort. The
        // executor must not need to recognise this SPECIFIC error shape —
        // only that `req.signal` (== its own AbortController) fired.
        throw new Error('simulated: request aborted mid-flight');
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    };
    const { executor, completed } = buildExecutor(llm);

    await executor.executeRuns('ws-1', pull(), repoRow(), [{ agent: agentFixture(), runId }]);

    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(abortedWhileStillInsideTheCall).toBe(true);
    expect(completed).toHaveLength(1);
    expect(completed[0]!.runId).toBe(runId);
    expect(completed[0]!.values.status).toBe('cancelled');
    expect(completed[0]!.values.error).toBe('Cancelled by user');
  });

  it('does NOT mark a genuine LLM failure as cancelled — only an aborted signal does', async () => {
    // Guards against the fix being too broad: if the executor mapped every
    // thrown error onto 'cancelled' the moment an AbortController existed,
    // ordinary failures (rate limits, bad output) would stop being reported
    // as failures at all.
    const runId = randomUUID();
    const llm: LLMProvider = {
      id: 'openai',
      async completeStructured() {
        throw new Error('rate limited');
      },
      async listModels() {
        return [];
      },
      async complete() {
        throw new Error('not used');
      },
      async embed() {
        return [];
      },
    };
    const { executor, completed } = buildExecutor(llm);

    await executor.executeRuns('ws-1', pull(), repoRow(), [{ agent: agentFixture(), runId }]);

    expect(completed).toHaveLength(1);
    expect(completed[0]!.values.status).toBe('failed');
    expect(completed[0]!.values.error).toBe('rate limited');
  });
});
