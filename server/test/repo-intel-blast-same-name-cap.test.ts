/**
 * Spec 0012 aliasing fix — two changed symbols that share a NAME but live in
 * different files must not merge into one capped pool. Before the fix,
 * `capCallersPerDeclaration` (repo-intel/service.ts, then still named
 * `capCallersPerSymbol`) grouped by bare `viaSymbol` alone, so 25 callers of
 * `a.ts`'s `helper` and 25 of `b.ts`'s `helper`
 * (50 total) would cap at MAX_CALLERS_PER_SYMBOL (20) COMBINED — losing 30
 * real callers and mixing the two declarations' callers into one bucket, the
 * server-side root cause of the client symptom (two rows expanding/collapsing
 * together and showing each other's callers).
 *
 * This test fails against that old grouping: it asserts 20 callers survive
 * for EACH file's `helper` (40 total, `viaFile`-tagged correctly), not 20
 * combined across both.
 *
 * No Postgres: same pattern as `repo-intel-blast-cap.test.ts` — a real
 * `RepoIntelRepository` with only the four methods `tryPersistentBlast`
 * reads monkey-patched, and a real `Container`.
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

describe('RepoIntelService.getBlastRadius — same-name symbols declared in different files', () => {
  it("caps each declaration's callers independently, keyed on (viaFile, viaSymbol)", async () => {
    const declRows = [
      { path: 'a.ts', name: 'helper', kind: 'function', line: 1, endLine: 5, exported: true, signature: null },
      { path: 'b.ts', name: 'helper', kind: 'function', line: 1, endLine: 5, exported: true, signature: null },
    ];

    const aRows: ResolvedCallerRow[] = Array.from({ length: 25 }, (_, i) => ({
      fromPath: `ca${i}.ts`,
      toSymbol: 'helper',
      declFile: 'a.ts',
      line: 1,
      rank: i, // 0..24
    }));
    const bRows: ResolvedCallerRow[] = Array.from({ length: 25 }, (_, i) => ({
      fromPath: `cb${i}.ts`,
      toSymbol: 'helper',
      declFile: 'b.ts',
      line: 1,
      rank: 200 + i, // 200..224 — disjoint from aRows so top-20 per group is unambiguous
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
      // First call: declaring symbols for changedFiles (['a.ts', 'b.ts']).
      // Second call: enclosing symbols for the ~50 caller files — none
      // provided, so the caller name falls back to the file's own basename.
      paths.length === 2 && paths.includes('a.ts') && paths.includes('b.ts') ? declRows : [];
    repo.getResolvedCallers = async () => [...aRows, ...bRows];
    repo.getFileFacts = async () => [];

    const container = new Container(testConfig(), UNUSED_DB);
    const service = new RepoIntelService(container, repo);

    const result = await service.getBlastRadius('r1', ['a.ts', 'b.ts']);

    expect(result.degraded).toBe(false);
    expect(result.changedSymbols).toEqual([
      { file: 'a.ts', name: 'helper', kind: 'function' },
      { file: 'b.ts', name: 'helper', kind: 'function' },
    ]);

    // 20 for EACH declaration's callers, not 20 combined — the fix.
    expect(result.callers).toHaveLength(2 * MAX_CALLERS_PER_SYMBOL);

    const byA = result.callers.filter((c) => c.viaFile === 'a.ts');
    const byB = result.callers.filter((c) => c.viaFile === 'b.ts');
    expect(byA).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(byB).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(byA.every((c) => c.viaSymbol === 'helper')).toBe(true);
    expect(byB.every((c) => c.viaSymbol === 'helper')).toBe(true);

    // The highest-ranked 20 of EACH group survive independently.
    expect(Math.min(...byA.map((c) => c.rank))).toBe(5);
    expect(Math.min(...byB.map((c) => c.rank))).toBe(205);
  });
});
