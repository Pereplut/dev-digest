/**
 * `BlastService.forPull` (spec 0012 §1) — tenancy first, then one facade call,
 * then the pure mapping. No Postgres.
 *
 * `Container` and `ReviewRepository` are REAL instances (never `as unknown as`
 * — server/INSIGHTS.md 2026-09-18 records that cast hiding a missing
 * dependency at runtime while typecheck stays green). A subclass overrides
 * only the two getters `BlastService` reads, so every other `Container`
 * member — including ones this module has never heard of — is still the real
 * implementation and would fail loudly if BlastService ever touched it.
 * `RepoIntel` is a plain interface (no private fields, unlike the classes
 * above), so the stub only implements `getBlastRadius` — the one method
 * `BlastService` calls — and is cast up to the interface; TypeScript accepts
 * this without `unknown` precisely because the interface is a superset of
 * what's implemented, not a mismatched shape.
 */
import { describe, it, expect, vi } from 'vitest';
import { BlastService } from '../src/modules/blast/service.js';
import { NotFoundError } from '../src/platform/errors.js';
import { ReviewRepository, type PullRow } from '../src/modules/reviews/repository.js';
import { Container } from '../src/platform/container.js';
import type { AppConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import type { RepoIntel, BlastResult } from '../src/modules/repo-intel/types.js';

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
    repoIntelEnabled: true,
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
    title: 't',
    author: 'a',
    branch: 'b',
    base: 'main',
    headSha: 'sha1',
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

/** RepoIntel implements only `getBlastRadius` — the sole method BlastService calls. */
function stubRepoIntel(getBlastRadius: RepoIntel['getBlastRadius']): RepoIntel {
  return { getBlastRadius } as RepoIntel;
}

class TestContainer extends Container {
  constructor(
    private readonly stubReviewRepo: ReviewRepository,
    private readonly stubRepoIntel: RepoIntel,
  ) {
    super(testConfig(), UNUSED_DB);
  }
  override get reviewRepo(): ReviewRepository {
    return this.stubReviewRepo;
  }
  override get repoIntel(): RepoIntel {
    return this.stubRepoIntel;
  }
}

const EMPTY_RESULT: BlastResult = { changedSymbols: [], callers: [], impactedEndpoints: [] };

describe('BlastService.forPull', () => {
  it('404s on an unknown pull request BEFORE the index is touched', async () => {
    const getBlastRadius = vi.fn(async () => EMPTY_RESULT);
    const reviewRepo = new ReviewRepository(UNUSED_DB);
    reviewRepo.getPull = async () => undefined;
    reviewRepo.getPrFiles = async () => {
      throw new Error('must not be reached');
    };
    const container = new TestContainer(reviewRepo, stubRepoIntel(getBlastRadius));
    const service = new BlastService(container);

    await expect(service.forPull('ws-1', 'unknown-pr')).rejects.toThrow(NotFoundError);
    expect(getBlastRadius).not.toHaveBeenCalled();
  });

  it('404s on a pull request in ANOTHER workspace BEFORE the index is touched', async () => {
    // getPull is itself workspace-scoped in the repository; a cross-workspace
    // lookup returns undefined exactly like an unknown id.
    const getBlastRadius = vi.fn(async () => EMPTY_RESULT);
    const reviewRepo = new ReviewRepository(UNUSED_DB);
    let calledWithWorkspace: string | undefined;
    reviewRepo.getPull = async (workspaceId) => {
      calledWithWorkspace = workspaceId;
      return undefined; // "pr-1" belongs to a different workspace than ws-other
    };
    reviewRepo.getPrFiles = async () => {
      throw new Error('must not be reached');
    };
    const container = new TestContainer(reviewRepo, stubRepoIntel(getBlastRadius));
    const service = new BlastService(container);

    await expect(service.forPull('ws-other', 'pr-1')).rejects.toThrow(NotFoundError);
    expect(calledWithWorkspace).toBe('ws-other');
    expect(getBlastRadius).not.toHaveBeenCalled();
  });

  it('fetches files and calls the facade exactly once for a real pull request', async () => {
    const getBlastRadius = vi.fn(async () => ({
      changedSymbols: [{ file: 'a.ts', name: 'rateLimit', kind: 'function' }],
      callers: [{ file: 'b.ts', symbol: 'handler', viaSymbol: 'rateLimit', line: 3, rank: 1 }],
      impactedEndpoints: ['GET /x'],
    } satisfies BlastResult));
    const reviewRepo = new ReviewRepository(UNUSED_DB);
    reviewRepo.getPull = async (workspaceId, prId) =>
      workspaceId === 'ws-1' && prId === 'pr-1' ? pull() : undefined;
    reviewRepo.getPrFiles = async () => [
      { id: 'f1', prId: 'pr-1', path: 'a.ts', additions: 1, deletions: 0, patch: null },
    ];
    const container = new TestContainer(reviewRepo, stubRepoIntel(getBlastRadius));
    const service = new BlastService(container);

    const radius = await service.forPull('ws-1', 'pr-1');

    expect(getBlastRadius).toHaveBeenCalledTimes(1);
    // `indexOnly: true` — spec 0012 AC12: this route never falls through to
    // the facade's clone-parsing best-effort path.
    expect(getBlastRadius).toHaveBeenCalledWith('repo-1', ['a.ts'], { indexOnly: true });
    expect(radius.changed_symbols).toEqual([{ name: 'rateLimit', file: 'a.ts', kind: 'function' }]);
    expect(radius.downstream[0]!.callers).toEqual([{ name: 'handler', file: 'b.ts', line: 3 }]);
  });
});
