/**
 * Spec 0012 (post-review) AC12 — `GET /pulls/:id/blast` must never trigger
 * clone parsing. `RepoIntelService.getBlastRadius(..., { indexOnly: true })`
 * is the opt-in that makes that literally true: when `tryPersistentBlast`
 * can't serve, it must return the degraded literal instead of falling
 * through to the best-effort path that calls `container.codeIndex`.
 *
 * `StubCodeIndex` throws on every method, so any call into the best-effort
 * path (`repo-intel/service.ts:246-298`) fails the test loudly rather than
 * silently degrading to the same shape a correct implementation would
 * produce. Same no-Postgres pattern as the sibling blast tests: real
 * `RepoIntelRepository`/`Container` instances with only the methods this
 * path reads monkey-patched or injected through `ContainerOverrides`.
 */
import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { RepoIntelRepository } from '../src/modules/repo-intel/repository.js';
import { Container } from '../src/platform/container.js';
import type { AppConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';
import type { CodeIndex, CodeMatch, CodeReference, CodeSymbol, RepoRef } from '@devdigest/shared';

const UNUSED_DB = null as unknown as Db;

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
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
    ...overrides,
  };
}

/** Every method throws — proof the best-effort (clone-parsing) path was never entered. */
class ThrowingCodeIndex implements CodeIndex {
  async grep(_repo: RepoRef, _pattern: string): Promise<CodeMatch[]> {
    throw new Error('must not be called: indexOnly must not enter the best-effort path');
  }
  async symbols(_repo: RepoRef): Promise<CodeSymbol[]> {
    throw new Error('must not be called: indexOnly must not enter the best-effort path');
  }
  async references(_repo: RepoRef, _symbol: string): Promise<CodeReference[]> {
    throw new Error('must not be called: indexOnly must not enter the best-effort path');
  }
}

function indexOnlyContainer(config: Partial<AppConfig> = {}): Container {
  return new Container(testConfig(config), UNUSED_DB, { codeIndex: new ThrowingCodeIndex() });
}

describe('RepoIntelService.getBlastRadius({ indexOnly: true })', () => {
  it('returns degraded/flag_off, without touching codeIndex, when the flag is off', async () => {
    const repo = new RepoIntelRepository(UNUSED_DB);
    repo.tryGetIndexState = async () => {
      throw new Error('must not be called: flag_off is decided before any index read');
    };
    const container = indexOnlyContainer({ repoIntelEnabled: false });
    const service = new RepoIntelService(container, repo);

    const result = await service.getBlastRadius('r1', ['a.ts'], { indexOnly: true });

    expect(result).toEqual({
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: true,
      reason: 'flag_off',
    });
  });

  it('returns degraded/no_data, without touching codeIndex, when no index was ever built', async () => {
    const repo = new RepoIntelRepository(UNUSED_DB);
    repo.tryGetIndexState = async () => null;
    const container = indexOnlyContainer();
    const service = new RepoIntelService(container, repo);

    const result = await service.getBlastRadius('r1', ['a.ts'], { indexOnly: true });

    expect(result).toEqual({
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: true,
      reason: 'no_data',
    });
  });

  it('returns degraded/index_failed, without touching codeIndex, when indexing failed', async () => {
    const repo = new RepoIntelRepository(UNUSED_DB);
    repo.tryGetIndexState = async (): Promise<IndexState> => ({
      repoId: 'r1',
      status: 'failed',
      filesIndexed: 0,
      filesSkipped: 0,
      durationMs: 1,
      lastIndexedSha: '',
      indexerVersion: 2,
      updatedAt: new Date(),
      degraded: true,
      degradedReason: 'index_failed',
    });
    const container = indexOnlyContainer();
    const service = new RepoIntelService(container, repo);

    const result = await service.getBlastRadius('r1', ['a.ts'], { indexOnly: true });

    expect(result).toEqual({
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: true,
      reason: 'index_failed',
    });
  });

  it('still serves the real persistent map when the index IS usable — indexOnly only bites on the bailout', async () => {
    const repo = new RepoIntelRepository(UNUSED_DB);
    repo.tryGetIndexState = async (): Promise<IndexState> => ({
      repoId: 'r1',
      status: 'full',
      filesIndexed: 1,
      filesSkipped: 0,
      durationMs: 1,
      lastIndexedSha: 'sha1',
      indexerVersion: 2,
      updatedAt: new Date(),
    });
    repo.getSymbolRows = async (_repoId, paths) =>
      paths.length === 1 && paths[0] === 'a.ts'
        ? [{ path: 'a.ts', name: 'rateLimit', kind: 'function', line: 1, endLine: 5, exported: true, signature: null }]
        : [];
    repo.getResolvedCallers = async () => [
      { fromPath: 'b.ts', toSymbol: 'rateLimit', declFile: 'a.ts', line: 3, rank: 1 },
    ];
    repo.getFileFacts = async () => [];
    const container = indexOnlyContainer();
    const service = new RepoIntelService(container, repo);

    const result = await service.getBlastRadius('r1', ['a.ts'], { indexOnly: true });

    expect(result.degraded).toBe(false);
    expect(result.callers).toHaveLength(1);
  });
});
