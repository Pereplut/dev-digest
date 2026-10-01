/**
 * `OnboardingService` — hermetic (a stubbed repository and container, no DB).
 *
 * This file grows across two commits: C3c covers the read path (`getTour`,
 * AC-3/AC-4/AC-51/AC-59's read half); C4 adds the generation path
 * (`startGeneration`/`runGeneration`) and the AC-31 sentinel test.
 */
import { describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { OnboardingService } from '../src/modules/onboarding/service.js';
import type { OnboardingRepository, OnboardingRow } from '../src/modules/onboarding/repository/onboarding.repo.js';
import type { Container } from '../src/platform/container.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';
import { GENERATION_STALE_MS, GENERATION_TIMEOUT_MS } from '../src/modules/onboarding/constants.js';

function indexState(over: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'r1',
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 1,
    lastIndexedSha: 'sha',
    indexerVersion: 2,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

function stubRepo(over: Partial<OnboardingRepository> = {}): OnboardingRepository {
  return {
    getRepoBasics: vi.fn().mockResolvedValue({ id: 'r1', fullName: 'acme/widgets', clonePath: null }),
    getRow: vi.fn().mockResolvedValue(undefined),
    listOpenFindings: vi.fn().mockResolvedValue([]),
    listPendingValidCandidates: vi.fn().mockResolvedValue([]),
    ...over,
  } as unknown as OnboardingRepository;
}

/**
 * In-memory repository carrying the SAME guard semantics the real SQL does
 * (invariant I3): every write but the claim checks `generation_id +
 * status='running'` and is a no-op otherwise. This is what makes the
 * two-generation / stale-superseded-write tests meaningful rather than
 * assumed.
 */
class FakeOnboardingRepo {
  row: OnboardingRow | undefined;
  calls = { listOpenFindings: 0, listPendingValidCandidates: 0 };

  constructor(initial?: Partial<OnboardingRow>) {
    // A fixture supplying only `generationId` means "already claimed and
    // running" — the common case these tests construct.
    this.row = initial
      ? ({
          repoId: 'r1',
          json: {},
          generatedAt: new Date(0),
          status: initial.generationId ? 'running' : 'not_generated',
          reason: null,
          startedAt: initial.generationId ? new Date() : null,
          jobId: null,
          generationId: null,
          ...initial,
        } as OnboardingRow)
      : undefined;
  }

  async getRepoBasics() {
    return { id: 'r1', fullName: 'acme/widgets', clonePath: tmpdir() };
  }
  async getRow() {
    return this.row;
  }
  async claimGeneration(repoId: string, generationId: string) {
    const stale = this.row?.startedAt ? Date.now() - this.row.startedAt.getTime() > GENERATION_STALE_MS : false;
    if (this.row && this.row.status === 'running' && !stale) return null;
    this.row = {
      repoId,
      json: this.row?.json ?? {},
      generatedAt: this.row?.generatedAt ?? new Date(0),
      status: 'running',
      reason: null,
      startedAt: new Date(),
      jobId: null,
      generationId,
    } as OnboardingRow;
    return this.row;
  }
  async setJobId(repoId: string, generationId: string, jobId: string) {
    if (this.row?.generationId === generationId && this.row.status === 'running') {
      this.row = { ...this.row, jobId };
    }
  }
  async markFailed(repoId: string, generationId: string) {
    if (this.row?.generationId === generationId && this.row.status === 'running') {
      this.row = { ...this.row, status: 'failed', reason: 'generation_failed', startedAt: null, jobId: null, generationId: null };
    }
  }
  async saveTour(repoId: string, generationId: string, sections: unknown, status: 'done' | 'partial') {
    if (this.row?.generationId === generationId && this.row.status === 'running') {
      this.row = {
        ...this.row,
        json: { sections },
        generatedAt: new Date(),
        status,
        reason: null,
        startedAt: null,
        jobId: null,
        generationId: null,
      } as OnboardingRow;
    }
  }
  async listOpenFindings() {
    this.calls.listOpenFindings += 1;
    return [];
  }
  async listPendingValidCandidates() {
    this.calls.listPendingValidCandidates += 1;
    return [];
  }
}

const SETTINGS_NO_OVERRIDE_DB = { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) };

function stubContainer(
  over: {
    repoIntelEnabled?: boolean;
    indexState?: IndexState;
    rankedPaths?: string[];
    completeStructured?: ReturnType<typeof vi.fn>;
  } = {},
): Container {
  const completeStructured = over.completeStructured ?? vi.fn().mockResolvedValue({ data: { sections: [] } });
  return {
    config: { repoIntelEnabled: over.repoIntelEnabled ?? true },
    db: SETTINGS_NO_OVERRIDE_DB as never,
    llm: vi.fn().mockResolvedValue({ completeStructured }),
    repoIntel: {
      getIndexState: vi.fn().mockResolvedValue(over.indexState ?? indexState()),
      getTopFilesByRank: vi.fn().mockResolvedValue(over.rankedPaths ?? ['src/app.ts']),
      getCriticalPaths: vi.fn().mockResolvedValue([]),
      getFileRank: vi.fn().mockResolvedValue([]),
    },
  } as unknown as Container;
}

function validDraftSections() {
  const kinds = ['architecture', 'critical_paths', 'run_locally', 'reading_path', 'first_tasks'] as const;
  return kinds.map((kind) => ({ kind, body: 'Grounded body text with no claims to check.', diagram: null, links: [] }));
}

describe('OnboardingService.getTour', () => {
  it('AC-4: never generated → status not_generated, five sections, all generated:false', async () => {
    const service = new OnboardingService(
      stubContainer(),
      stubRepo({ getRepoBasics: vi.fn().mockResolvedValue({ id: 'r1', fullName: 'acme/widgets', clonePath: tmpdir() }) }),
    );
    const tour = await service.getTour('ws1', 'r1');
    expect(tour.status).toBe('not_generated');
    expect(tour.reason).toBeNull();
    expect(tour.sections).toHaveLength(5);
    expect(tour.sections.every((s) => !s.generated)).toBe(true);
    expect(tour.generated_at).toBeNull();
  });

  it('AC-51: files_indexed reflects a real index row', async () => {
    const service = new OnboardingService(
      stubContainer({ indexState: indexState({ filesIndexed: 123 }) }),
      stubRepo(),
    );
    const tour = await service.getTour('ws1', 'r1');
    expect(tour.files_indexed).toBe(123);
  });

  it('files_indexed is null for a synthesised (never-indexed) row', async () => {
    const service = new OnboardingService(
      stubContainer({ indexState: indexState({ status: 'degraded', updatedAt: new Date(0) }) }),
      stubRepo(),
    );
    const tour = await service.getTour('ws1', 'r1');
    expect(tour.files_indexed).toBeNull();
  });

  it('AC-5/AC-9: no_clone precondition reported, even with a stored tour, and outranks generation_failed', async () => {
    const row = {
      repoId: 'r1',
      json: { sections: [] },
      generatedAt: new Date('2026-01-01T00:00:00Z'),
      status: 'failed',
      reason: 'generation_failed',
      startedAt: null,
      jobId: null,
      generationId: null,
    } as unknown as OnboardingRow;
    const service = new OnboardingService(
      stubContainer({ rankedPaths: [] }),
      stubRepo({ getRow: vi.fn().mockResolvedValue(row) }),
    );
    const tour = await service.getTour('ws1', 'r1');
    // clonePath is null in stubRepo()'s default repo basics ⇒ no_clone, which
    // outranks the stored row's own generation_failed per AC-9.
    expect(tour.reason).toBe('no_clone');
  });

  it('AC-59: a failed newest generation over a last good tour serves the stored sections unchanged', async () => {
    const storedSections = [
      { kind: 'architecture', title: 'Architecture', body: 'Real content.', diagram: null, links: [], generated: true, degraded_reason: null, dropped_refs: 0, truncated: false, items: [], commands: [] },
      { kind: 'critical_paths', title: 'Critical Paths', body: 'Real content.', diagram: null, links: [], generated: true, degraded_reason: null, dropped_refs: 0, truncated: false, items: [], commands: [] },
      { kind: 'run_locally', title: 'Run Locally', body: 'Real content.', diagram: null, links: [], generated: true, degraded_reason: null, dropped_refs: 0, truncated: false, items: [], commands: [] },
      { kind: 'reading_path', title: 'Reading Path', body: 'Real content.', diagram: null, links: [], generated: true, degraded_reason: null, dropped_refs: 0, truncated: false, items: [], commands: [] },
      { kind: 'first_tasks', title: 'First Tasks', body: 'Real content.', diagram: null, links: [], generated: true, degraded_reason: null, dropped_refs: 0, truncated: false, items: [], commands: [] },
    ];
    const generatedAt = new Date('2026-01-01T00:00:00Z');
    const row = {
      repoId: 'r1',
      json: { sections: storedSections },
      generatedAt,
      status: 'failed',
      reason: null,
      startedAt: null,
      jobId: null,
      generationId: null,
    } as unknown as OnboardingRow;
    const service = new OnboardingService(
      stubContainer(),
      stubRepo({
        getRow: vi.fn().mockResolvedValue(row),
        getRepoBasics: vi.fn().mockResolvedValue({ id: 'r1', fullName: 'acme/widgets', clonePath: tmpdir() }),
      }),
    );
    const tour = await service.getTour('ws1', 'r1');
    expect(tour.status).toBe('failed');
    expect(tour.reason).toBe('generation_failed');
    expect(tour.sections).toEqual(storedSections);
    expect(tour.generated_at).toBe(generatedAt.toISOString());
  });

  it('a GET with stored sections never calls listOpenFindings/listPendingValidCandidates (skips facts entirely)', async () => {
    const row = {
      repoId: 'r1',
      json: { sections: [{ kind: 'architecture', title: 'Architecture', body: 'x', diagram: null, links: [], generated: true, degraded_reason: null, dropped_refs: 0, truncated: false, items: [], commands: [] }] },
      generatedAt: new Date(),
      status: 'done',
      reason: null,
      startedAt: null,
      jobId: null,
      generationId: null,
    } as unknown as OnboardingRow;
    const listOpenFindings = vi.fn().mockResolvedValue([]);
    const listPendingValidCandidates = vi.fn().mockResolvedValue([]);
    const service = new OnboardingService(
      stubContainer(),
      stubRepo({
        getRow: vi.fn().mockResolvedValue(row),
        getRepoBasics: vi.fn().mockResolvedValue({ id: 'r1', fullName: 'acme/widgets', clonePath: '/tmp/clone' }),
        listOpenFindings,
        listPendingValidCandidates,
      }),
    );
    await service.getTour('ws1', 'r1');
    expect(listOpenFindings).not.toHaveBeenCalled();
    expect(listPendingValidCandidates).not.toHaveBeenCalled();
  });
});

describe('OnboardingService.runGeneration', () => {
  it('AC-14: resolves the model through resolveFeatureModel(…, "onboarding") — the registry default (openrouter)', async () => {
    const completeStructured = vi.fn().mockResolvedValue({ data: { sections: validDraftSections() } });
    const container = stubContainer({ completeStructured });
    const repo = new FakeOnboardingRepo({ generationId: 'g1' });
    const service = new OnboardingService(container, repo as unknown as OnboardingRepository);

    await service.runGeneration('ws1', 'r1', 'g1');
    expect(container.llm).toHaveBeenCalledWith('openrouter');
  });

  it('AC-13/AC-15: a throwing completeStructured call ends the row failed/generation_failed, writing no sections', async () => {
    const completeStructured = vi.fn().mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }));
    const container = stubContainer({ completeStructured });
    const repo = new FakeOnboardingRepo({ generationId: 'g1' });
    const service = new OnboardingService(container, repo as unknown as OnboardingRepository);

    await expect(service.runGeneration('ws1', 'r1', 'g1')).rejects.toThrow();
    expect(repo.row?.status).toBe('failed');
    expect(repo.row?.reason).toBe('generation_failed');
    expect(repo.row?.json).toEqual({});
  });

  it('AC-13: the rethrown error carries no .status — JobRunner cannot treat it as retryable', async () => {
    const completeStructured = vi.fn().mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }));
    const container = stubContainer({ completeStructured });
    const repo = new FakeOnboardingRepo({ generationId: 'g1' });
    const service = new OnboardingService(container, repo as unknown as OnboardingRepository);

    try {
      await service.runGeneration('ws1', 'r1', 'g1');
      expect.unreachable();
    } catch (err) {
      expect((err as { status?: number }).status).toBeUndefined();
    }
  });

  it('decision 3: a call whose identity no longer matches the row is a silent no-op (closes the retried-after-success escape)', async () => {
    const completeStructured = vi.fn();
    const container = stubContainer({ completeStructured });
    // The row belongs to a DIFFERENT generation than the one this call names.
    const repo = new FakeOnboardingRepo({ generationId: 'other-generation' });
    const service = new OnboardingService(container, repo as unknown as OnboardingRepository);

    await service.runGeneration('ws1', 'r1', 'stale-generation-id');
    expect(completeStructured).not.toHaveBeenCalled();
  });

  it('AC-16: a never-settling provider call gives failed before 120_000ms (fake timers)', async () => {
    vi.useFakeTimers();
    try {
      const completeStructured = vi.fn(() => new Promise(() => undefined));
      const container = stubContainer({ completeStructured });
      const repo = new FakeOnboardingRepo({ generationId: 'g1' });
      const service = new OnboardingService(container, repo as unknown as OnboardingRepository);

      const run = service.runGeneration('ws1', 'r1', 'g1').catch(() => undefined);
      await vi.advanceTimersByTimeAsync(GENERATION_TIMEOUT_MS + 1_000);
      await run;

      expect(repo.row?.status).toBe('failed');
      expect(GENERATION_TIMEOUT_MS + 1_000).toBeLessThan(120_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('AC-16: the timeout races the WHOLE body, not just the model call — a never-settling readTextFileInClone also fails before 120_000ms', async () => {
    vi.resetModules();
    vi.doMock('../src/platform/safe-read.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/platform/safe-read.js')>();
      return { ...actual, readTextFileInClone: vi.fn(() => new Promise(() => undefined)) };
    });
    vi.useFakeTimers();
    try {
      const { OnboardingService: ScopedService } = await import('../src/modules/onboarding/service.js');
      const completeStructured = vi.fn().mockResolvedValue({ data: { sections: validDraftSections() } });
      const container = stubContainer({ completeStructured });
      const repo = new FakeOnboardingRepo({ generationId: 'g1' });
      const service = new ScopedService(container, repo as unknown as OnboardingRepository);

      const run = service.runGeneration('ws1', 'r1', 'g1').catch(() => undefined);
      await vi.advanceTimersByTimeAsync(GENERATION_TIMEOUT_MS + 1_000);
      await run;

      expect(repo.row?.status).toBe('failed');
      // The provider was never even reached — the clone read hung first.
      expect(completeStructured).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.doUnmock('../src/platform/safe-read.js');
      vi.resetModules();
    }
  });

  it('a handler that settles in 10ms is never marked failed', async () => {
    const completeStructured = vi.fn().mockResolvedValue({ data: { sections: validDraftSections() } });
    const container = stubContainer({ completeStructured });
    const repo = new FakeOnboardingRepo({ generationId: 'g1' });
    const service = new OnboardingService(container, repo as unknown as OnboardingRepository);

    await service.runGeneration('ws1', 'r1', 'g1');
    expect(repo.row?.status).not.toBe('failed');
  });

  it('AC-22/AC-23: a full valid draft → done; two empty bodies → partial', async () => {
    const container1 = stubContainer({
      completeStructured: vi.fn().mockResolvedValue({ data: { sections: validDraftSections() } }),
    });
    const repo1 = new FakeOnboardingRepo({ generationId: 'g1' });
    await new OnboardingService(container1, repo1 as unknown as OnboardingRepository).runGeneration('ws1', 'r1', 'g1');
    expect(repo1.row?.status).toBe('done');

    const partialSections = validDraftSections().map((s, i) => (i < 2 ? { ...s, body: '' } : s));
    const container2 = stubContainer({
      completeStructured: vi.fn().mockResolvedValue({ data: { sections: partialSections } }),
    });
    const repo2 = new FakeOnboardingRepo({ generationId: 'g1' });
    await new OnboardingService(container2, repo2 as unknown as OnboardingRepository).runGeneration('ws1', 'r1', 'g1');
    expect(repo2.row?.status).toBe('partial');
  });

  it('the two-generation case: B claims, then A settles and its saveTour affects zero rows', async () => {
    // Built BEFORE the mock is invoked, so resolving it never races against
    // whether `completeStructured` has actually been called yet.
    let resolveA!: (value: { data: { sections: ReturnType<typeof validDraftSections> } }) => void;
    const deferredA = new Promise<{ data: { sections: ReturnType<typeof validDraftSections> } }>((resolve) => {
      resolveA = resolve;
    });
    const completeStructured = vi.fn(() => deferredA);
    const container = stubContainer({ completeStructured });
    const repo = new FakeOnboardingRepo({ generationId: 'A' });
    const service = new OnboardingService(container, repo as unknown as OnboardingRepository);

    const runA = service.runGeneration('ws1', 'r1', 'A');
    // B's claim lands while A is still in flight — A's identity re-read has
    // already passed, its write is still to come. A's row went stale (the
    // realistic path to AC-20's takeover: e.g. a boot reap or the stale
    // window itself), so B's claim succeeds over it mid-flight.
    repo.row = { ...repo.row!, startedAt: new Date(Date.now() - GENERATION_STALE_MS - 1) };
    await repo.claimGeneration('r1', 'B');
    expect(repo.row?.generationId).toBe('B');

    resolveA({ data: { sections: validDraftSections() } });
    await runA;

    // A's saveTour matched no row (guarded by generation_id = 'A' AND
    // status='running'), so B's claim survives untouched.
    expect(repo.row?.generationId).toBe('B');
    expect(repo.row?.status).toBe('running');
  });

  it('AC-58: a seeded last good DONE tour survives a failed regeneration by deep equality', async () => {
    const goodSections = validDraftSections().map((s) => ({
      kind: s.kind,
      title: s.kind,
      body: s.body,
      diagram: null,
      links: [],
      generated: true,
      degraded_reason: null,
      dropped_refs: 0,
      truncated: false,
      items: [],
      commands: [],
    }));
    const generatedAt = new Date('2026-02-01T00:00:00Z');
    const completeStructured = vi.fn().mockRejectedValue(new Error('boom'));
    const container = stubContainer({ completeStructured });
    const repo = new FakeOnboardingRepo({
      json: { sections: goodSections },
      generatedAt,
      status: 'running',
      generationId: 'g2',
    });
    const service = new OnboardingService(container, repo as unknown as OnboardingRepository);

    await expect(service.runGeneration('ws1', 'r1', 'g2')).rejects.toThrow();
    expect(repo.row?.json).toEqual({ sections: goodSections });
    expect(repo.row?.generatedAt).toEqual(generatedAt);
    expect(repo.row?.status).toBe('failed');
  });

  it('paired: the same regeneration SUCCEEDING replaces the stored sections', async () => {
    const oldSections = [{ kind: 'architecture', title: 'Architecture', body: 'Old content.', diagram: null, links: [], generated: true, degraded_reason: null, dropped_refs: 0, truncated: false, items: [], commands: [] }];
    const completeStructured = vi.fn().mockResolvedValue({ data: { sections: validDraftSections() } });
    const container = stubContainer({ completeStructured });
    const repo = new FakeOnboardingRepo({
      json: { sections: oldSections },
      generatedAt: new Date('2026-01-01T00:00:00Z'),
      status: 'running',
      generationId: 'g3',
    });
    const service = new OnboardingService(container, repo as unknown as OnboardingRepository);

    await service.runGeneration('ws1', 'r1', 'g3');
    expect(repo.row?.status).toBe('done');
    const stored = repo.row?.json as { sections: { body: string }[] };
    expect(stored.sections.map((s) => s.body)).not.toEqual(oldSections.map((s) => s.body));
  });
});

describe('AC-31 — the failure path renders through the same function as success', () => {
  it('generation with no last good tour calls renderSections zero times; the following GET calls it exactly once with draft=null', async () => {
    vi.resetModules();
    const SENTINEL_BODY = 'SENTINEL_BODY_ONLY_THE_MOCK_KNOWS';
    vi.doMock('../src/modules/onboarding/render.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/modules/onboarding/render.js')>();
      return {
        ...actual,
        renderSections: vi.fn(() => [
          { kind: 'architecture', title: 'Architecture', body: SENTINEL_BODY, diagram: null, links: [], generated: false, degraded_reason: null, dropped_refs: 0, truncated: false, items: [], commands: [] },
          { kind: 'critical_paths', title: 'Critical Paths', body: SENTINEL_BODY, diagram: null, links: [], generated: false, degraded_reason: null, dropped_refs: 0, truncated: false, items: [], commands: [] },
          { kind: 'run_locally', title: 'Run Locally', body: SENTINEL_BODY, diagram: null, links: [], generated: false, degraded_reason: null, dropped_refs: 0, truncated: false, items: [], commands: [] },
          { kind: 'reading_path', title: 'Reading Path', body: SENTINEL_BODY, diagram: null, links: [], generated: false, degraded_reason: null, dropped_refs: 0, truncated: false, items: [], commands: [] },
          { kind: 'first_tasks', title: 'First Tasks', body: SENTINEL_BODY, diagram: null, links: [], generated: false, degraded_reason: null, dropped_refs: 0, truncated: false, items: [], commands: [] },
        ]),
      };
    });

    try {
      const { OnboardingService: ScopedService } = await import('../src/modules/onboarding/service.js');
      const { renderSections: spiedRenderSections } = await import('../src/modules/onboarding/render.js');

      const completeStructured = vi.fn().mockRejectedValue(new Error('boom'));
      const container = stubContainer({ completeStructured });
      const repo = new FakeOnboardingRepo({ generationId: 'g1' });
      const service = new ScopedService(container, repo as unknown as OnboardingRepository);

      await expect(service.runGeneration('ws1', 'r1', 'g1')).rejects.toThrow();
      expect(spiedRenderSections).not.toHaveBeenCalled();

      vi.clearAllMocks();
      const tour = await service.getTour('ws1', 'r1');

      expect(spiedRenderSections).toHaveBeenCalledTimes(1);
      expect(spiedRenderSections).toHaveBeenCalledWith(expect.anything(), expect.anything(), null);
      expect(tour.sections.every((s) => s.body === SENTINEL_BODY)).toBe(true);
    } finally {
      vi.doUnmock('../src/modules/onboarding/render.js');
      vi.resetModules();
    }
  });

  it('closure 2: SECTION_FALLBACK_BODIES is exported from render.ts and service.ts exports no equivalent', async () => {
    const renderModule = await import('../src/modules/onboarding/render.js');
    expect(renderModule.SECTION_FALLBACK_BODIES).toBeDefined();
    const serviceModule = (await import('../src/modules/onboarding/service.js')) as unknown as Record<string, unknown>;
    expect(serviceModule.SECTION_FALLBACK_BODIES).toBeUndefined();
  });
});

describe('onboarding constants', () => {
  it('GENERATION_TIMEOUT_MS is strictly less than JobRunner timeout (120_000)', () => {
    expect(GENERATION_TIMEOUT_MS).toBeLessThan(120_000);
  });

  it('GENERATION_STALE_MS is strictly greater than GENERATION_TIMEOUT_MS', () => {
    expect(GENERATION_STALE_MS).toBeGreaterThan(GENERATION_TIMEOUT_MS);
  });
});
