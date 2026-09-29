/**
 * Spec 0012 "the facade fix" — `tryPersistentBlast` (repo-intel/service.ts)
 * used to cap `MAX_CALLERS_PER_SYMBOL` over the FLAT, all-symbols caller list
 * (`callers.slice(0, N)`), so a PR touching several changed symbols kept only
 * 20 callers total instead of 20 PER symbol. This asserts the fix: > 20
 * callers spread over TWO `viaSymbol` values keep 20 each, rank order
 * preserved, and fails against the old total-cap `slice`.
 *
 * No Postgres: `RepoIntelRepository` is a REAL instance (so its type is never
 * faked), with only the four methods `tryPersistentBlast` reads monkey-patched
 * to avoid touching `db` — every other method stays real and would throw if
 * accidentally invoked. Same for `Container`: a real instance, `config` is the
 * only field this path reads.
 */
import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { RepoIntelRepository, type ResolvedCallerRow } from '../src/modules/repo-intel/repository.js';
import { Container } from '../src/platform/container.js';
import type { AppConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';

// A `Db` value this path never queries (every DB-touching repository method
// below is overridden) — the leaf placeholder, not a faked container.
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

describe('RepoIntelService.getBlastRadius — per-viaSymbol caller cap', () => {
  it('keeps MAX_CALLERS_PER_SYMBOL callers PER changed symbol, not in total', async () => {
    const declRows = [
      { path: 'a.ts', name: 'rateLimit', kind: 'function', line: 1, endLine: 5, exported: true, signature: null },
      { path: 'a.ts', name: 'clamp', kind: 'function', line: 10, endLine: 15, exported: true, signature: null },
    ];

    const rateLimitRows: ResolvedCallerRow[] = Array.from({ length: 25 }, (_, i) => ({
      fromPath: `r${i}.ts`,
      toSymbol: 'rateLimit',
      declFile: 'a.ts',
      line: 1,
      rank: i, // 0..24
    }));
    const clampRows: ResolvedCallerRow[] = Array.from({ length: 25 }, (_, i) => ({
      fromPath: `c${i}.ts`,
      toSymbol: 'clamp',
      declFile: 'a.ts',
      line: 1,
      rank: 200 + i, // 200..224 — disjoint range so top-20 is unambiguous
    }));

    const repo = new RepoIntelRepository(UNUSED_DB);
    repo.tryGetIndexState = async (): Promise<IndexState | null> => ({
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
      // First call: declaring symbols for changedFiles (['a.ts']).
      // Second call: enclosing symbols for the ~50 caller files — none
      // provided, so the caller name falls back to the file's own basename.
      paths.length === 1 && paths[0] === 'a.ts' ? declRows : [];
    repo.getResolvedCallers = async () => [...rateLimitRows, ...clampRows];
    repo.getFileFacts = async () => [];

    const container = new Container(testConfig(), UNUSED_DB);
    const service = new RepoIntelService(container, repo);

    const result = await service.getBlastRadius('r1', ['a.ts']);

    expect(result.degraded).toBe(false);
    expect(result.callers).toHaveLength(2 * MAX_CALLERS_PER_SYMBOL);

    const byRateLimit = result.callers.filter((c) => c.viaSymbol === 'rateLimit');
    const byClamp = result.callers.filter((c) => c.viaSymbol === 'clamp');
    expect(byRateLimit).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(byClamp).toHaveLength(MAX_CALLERS_PER_SYMBOL);

    // The highest-ranked 20 of each group survive (rank 5..24 / 205..224) —
    // the lowest 5 of each (0..4 / 200..204) are dropped.
    expect(Math.min(...byRateLimit.map((c) => c.rank))).toBe(5);
    expect(Math.min(...byClamp.map((c) => c.rank))).toBe(205);

    // Rank order is preserved in the flattened, capped list.
    for (let i = 1; i < result.callers.length; i++) {
      expect(result.callers[i]!.rank).toBeLessThanOrEqual(result.callers[i - 1]!.rank);
    }
  });
});
