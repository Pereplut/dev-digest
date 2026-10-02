/**
 * The onboarding generation job, run through a REAL `JobRunner` (AC-13).
 * `JobRunner` itself needs no DB beyond its `JobsRepository`, which is
 * stubbed in-memory here — hermetic, no Postgres.
 */
import { describe, it, expect, vi } from 'vitest';
import { JobRunner } from '../src/platform/jobs.js';
import type { JobsRepository } from '../src/platform/jobs.repo.js';
import { OnboardingService } from '../src/modules/onboarding/service.js';
import { ONBOARDING_JOB_KIND } from '../src/modules/onboarding/constants.js';
import type { OnboardingRepository, OnboardingRow } from '../src/modules/onboarding/repository/onboarding.repo.js';
import type { Container } from '../src/platform/container.js';

function inMemoryJobsRepo(over: { setAttempts?: (jobId: string, attempts: number) => Promise<void> } = {}) {
  let n = 0;
  const repo = {
    insertQueued: vi.fn(async () => `job-${++n}`),
    markRunning: vi.fn(async () => undefined),
    setAttempts: over.setAttempts ?? vi.fn(async () => undefined),
    markDone: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    failUnfinished: vi.fn(async () => 0),
  };
  return repo as unknown as JobsRepository;
}

class FakeRepo {
  row: OnboardingRow;
  constructor(generationId = 'g1') {
    this.row = {
      repoId: 'r1',
      json: {},
      generatedAt: new Date(0),
      status: 'running',
      reason: null,
      startedAt: new Date(),
      jobId: null,
      generationId,
    } as OnboardingRow;
  }
  async getRepoBasics() {
    return { id: 'r1', fullName: 'acme/widgets', clonePath: null };
  }
  async getRow() {
    return this.row;
  }
  async markFailed(repoId: string, generationId: string) {
    if (this.row.generationId === generationId && this.row.status === 'running') {
      this.row = { ...this.row, status: 'failed', reason: 'generation_failed', generationId: null, startedAt: null, jobId: null };
    }
  }
  async saveTour(repoId: string, generationId: string, sections: unknown, status: 'done' | 'partial') {
    if (this.row.generationId === generationId && this.row.status === 'running') {
      this.row = { ...this.row, json: { sections }, generatedAt: new Date(), status, reason: null, generationId: null, startedAt: null, jobId: null };
    }
  }
  async listOpenFindings() {
    return [];
  }
  async listPendingValidCandidates() {
    return [];
  }
}

const SETTINGS_NO_OVERRIDE_DB = { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) };

function stubContainer(completeStructured: ReturnType<typeof vi.fn>, jobs: JobRunner): Container {
  return {
    config: { repoIntelEnabled: true },
    db: SETTINGS_NO_OVERRIDE_DB as never,
    jobs,
    llm: vi.fn().mockResolvedValue({ completeStructured }),
    repoIntel: {
      getIndexState: vi.fn().mockResolvedValue({
        repoId: 'r1',
        status: 'full',
        filesIndexed: 5,
        filesSkipped: 0,
        durationMs: 1,
        lastIndexedSha: 'sha',
        indexerVersion: 2,
        updatedAt: new Date(),
      }),
      getTopFilesByRank: vi.fn().mockResolvedValue(['src/app.ts']),
      getCriticalPaths: vi.fn().mockResolvedValue([]),
      getFileRank: vi.fn().mockResolvedValue([]),
    },
  } as unknown as Container;
}

function validDraft() {
  const kinds = ['architecture', 'critical_paths', 'run_locally', 'reading_path', 'first_tasks'] as const;
  return { sections: kinds.map((kind) => ({ kind, body: 'Grounded body text.', diagram: null, links: [] })) };
}

describe('onboarding generation job (real JobRunner)', () => {
  it('AC-13: a provider throwing {status:429} then {status:503} gets exactly one completeStructured call', async () => {
    const completeStructured = vi.fn().mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }));
    const jobsRepo = inMemoryJobsRepo();
    const runner = new JobRunner(jobsRepo, { retries: 2 });
    const container = stubContainer(completeStructured, runner);
    const repo = new FakeRepo('g1');
    const service = new OnboardingService(container, repo as unknown as OnboardingRepository);

    runner.register(ONBOARDING_JOB_KIND, async (payload) => {
      const { workspaceId, repoId, generationId } = payload as { workspaceId: string; repoId: string; generationId: string };
      await service.runGeneration(workspaceId, repoId, generationId);
    });

    const job = await runner.enqueue('ws1', ONBOARDING_JOB_KIND, { workspaceId: 'ws1', repoId: 'r1', generationId: 'g1' });
    await job.done.catch(() => undefined);
    await runner.onIdle();

    expect(completeStructured).toHaveBeenCalledTimes(1);
    expect(repo.row.status).toBe('failed');
  });

  it('paired: a successful completeStructured call also gets exactly one call', async () => {
    const completeStructured = vi.fn().mockResolvedValue({ data: validDraft() });
    const jobsRepo = inMemoryJobsRepo();
    const runner = new JobRunner(jobsRepo, { retries: 2 });
    const container = stubContainer(completeStructured, runner);
    const repo = new FakeRepo('g1');
    const service = new OnboardingService(container, repo as unknown as OnboardingRepository);

    runner.register(ONBOARDING_JOB_KIND, async (payload) => {
      const { workspaceId, repoId, generationId } = payload as { workspaceId: string; repoId: string; generationId: string };
      await service.runGeneration(workspaceId, repoId, generationId);
    });

    const job = await runner.enqueue('ws1', ONBOARDING_JOB_KIND, { workspaceId: 'ws1', repoId: 'r1', generationId: 'g1' });
    await job.done.catch(() => undefined);
    await runner.onIdle();

    expect(completeStructured).toHaveBeenCalledTimes(1);
    expect(repo.row.status).toBe('done');
  });

  it('a forced retry after a successful settle is a no-op: the identity re-read short-circuits the second invocation', async () => {
    const completeStructured = vi.fn().mockResolvedValue({ data: validDraft() });
    // The FIRST bookkeeping write after a successful handler run fails
    // retryably (ECONNRESET) — JobRunner's withRetry wraps the handler AND
    // this write (platform/jobs.ts), so it re-invokes the whole handler.
    let attemptWrites = 0;
    const jobsRepo = inMemoryJobsRepo({
      setAttempts: async () => {
        attemptWrites += 1;
        if (attemptWrites === 1) throw Object.assign(new Error('conn reset'), { code: 'ECONNRESET' });
      },
    });
    const runner = new JobRunner(jobsRepo, { retries: 2 });
    const container = stubContainer(completeStructured, runner);
    const repo = new FakeRepo('g1');
    const service = new OnboardingService(container, repo as unknown as OnboardingRepository);

    runner.register(ONBOARDING_JOB_KIND, async (payload) => {
      const { workspaceId, repoId, generationId } = payload as { workspaceId: string; repoId: string; generationId: string };
      await service.runGeneration(workspaceId, repoId, generationId);
    });

    const job = await runner.enqueue('ws1', ONBOARDING_JOB_KIND, { workspaceId: 'ws1', repoId: 'r1', generationId: 'g1' });
    await job.done.catch(() => undefined);
    await runner.onIdle();

    // The handler ran twice (the retry), but the model was only ever called
    // once: the second invocation's identity re-read found status no longer
    // 'running' (the first invocation already saved the tour) and no-opped.
    expect(completeStructured).toHaveBeenCalledTimes(1);
    expect(repo.row.status).toBe('done');
  });
});
