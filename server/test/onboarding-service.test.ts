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

function stubContainer(over: { repoIntelEnabled?: boolean; indexState?: IndexState; rankedPaths?: string[] } = {}): Container {
  return {
    config: { repoIntelEnabled: over.repoIntelEnabled ?? true },
    db: {} as never,
    repoIntel: {
      getIndexState: vi.fn().mockResolvedValue(over.indexState ?? indexState()),
      getTopFilesByRank: vi.fn().mockResolvedValue(over.rankedPaths ?? ['src/app.ts']),
      getCriticalPaths: vi.fn().mockResolvedValue([]),
      getFileRank: vi.fn().mockResolvedValue([]),
    },
  } as unknown as Container;
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

describe('onboarding constants', () => {
  it('GENERATION_TIMEOUT_MS is strictly less than JobRunner timeout (120_000)', () => {
    expect(GENERATION_TIMEOUT_MS).toBeLessThan(120_000);
  });

  it('GENERATION_STALE_MS is strictly greater than GENERATION_TIMEOUT_MS', () => {
    expect(GENERATION_STALE_MS).toBeGreaterThan(GENERATION_TIMEOUT_MS);
  });
});
