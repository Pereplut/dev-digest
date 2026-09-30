/**
 * Spec 0012 AC13 — "a changed symbol's declaring file never appears among its
 * own callers." The invariant is enforced in exactly one place:
 * `RepoIntelService.getBlastRadius`'s best-effort (ripgrep) path,
 * `repo-intel/service.ts:277` — `if (r.fromPath === sym.file) continue`.
 *
 * `blast-helpers.test.ts` used to assert this invariant with a fixture whose
 * only caller lived in a DIFFERENT file from the decl file, which passes
 * under any implementation (including one that reintroduced same-file
 * callers) because `buildBlastRadius` cannot invent rows it wasn't given.
 * This test drives the real enforcement point instead: `container.codeIndex`
 * is stubbed to return both a same-file reference (must be dropped) and an
 * other-file reference (must survive) for the same symbol.
 *
 * No Postgres: `RepoIntelRepository` is a REAL instance with only
 * `getRepoBasics` monkey-patched (same pattern as
 * `repo-intel-blast-cap.test.ts`), and `Container` is a real instance with
 * `codeIndex` injected through the sanctioned `ContainerOverrides` seam — no
 * `as unknown as` casts.
 */
import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { RepoIntelRepository } from '../src/modules/repo-intel/repository.js';
import { Container } from '../src/platform/container.js';
import type { AppConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import type {
  CodeIndex,
  CodeMatch,
  CodeReference,
  CodeSymbol,
  RepoRef,
} from '@devdigest/shared';

// A `Db` value this path never queries (`getRepoBasics` is the only
// DB-touching repository method this path reads, and it is overridden below).
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
    // Forces the best-effort ripgrep path (`getBlastRadius`'s own loop),
    // never `tryPersistentBlast` — the path this test targets.
    repoIntelEnabled: false,
    promptLogVerbose: false,
    promptLogVerboseIgnored: false,
    promptLogEnabled: false,
    ...overrides,
  };
}

/** Declares `rateLimit` in `a.ts`; references it from both `a.ts` itself and `router.ts`. */
class StubCodeIndex implements CodeIndex {
  async grep(_repo: RepoRef, _pattern: string): Promise<CodeMatch[]> {
    return [];
  }
  async symbols(_repo: RepoRef): Promise<CodeSymbol[]> {
    return [{ path: 'a.ts', name: 'rateLimit', kind: 'function', line: 1 }];
  }
  async references(_repo: RepoRef, symbol: string): Promise<CodeReference[]> {
    return [
      // Same file as the declaration — must be excluded.
      { fromPath: 'a.ts', toSymbol: symbol, line: 99 },
      // A different file — must survive as a real caller.
      { fromPath: 'router.ts', toSymbol: symbol, line: 10 },
    ];
  }
}

describe('RepoIntelService.getBlastRadius — decl-file exclusion (best-effort path)', () => {
  it('drops the same-file reference and keeps the other-file one', async () => {
    const repo = new RepoIntelRepository(UNUSED_DB);
    repo.getRepoBasics = async () => ({
      id: 'r1',
      owner: 'acme',
      name: 'widgets',
      defaultBranch: 'main',
      // Non-existent path is fine: `readClone` catches the ENOENT and treats
      // it as "no endpoint facts for this file", which is not what this test
      // is about.
      clonePath: '/tmp/does-not-exist-blast-decl-exclusion',
    });

    const container = new Container(testConfig(), UNUSED_DB, { codeIndex: new StubCodeIndex() });
    const service = new RepoIntelService(container, repo);

    const result = await service.getBlastRadius('r1', ['a.ts']);

    expect(result.callers).toHaveLength(1);
    expect(result.callers[0]!.file).toBe('router.ts');
    expect(result.callers.some((c) => c.file === 'a.ts')).toBe(false);
  });
});
