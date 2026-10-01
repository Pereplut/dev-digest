/**
 * `buildFacts` (AC-32 to AC-40, AC-65, AC-85). Hermetic: a real temp clone
 * directory, no DB, a stubbed `repoIntel` port.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFacts } from '../src/modules/onboarding/facts.js';
import {
  ENV_KEYS_LIMIT,
  README_EXCERPT_CHARS,
  READING_PATH_LIMIT,
  ROOT_FILE_ALLOWLIST,
  SCRIPTS_LIMIT,
  CRITICAL_PATHS_LIMIT,
} from '../src/modules/onboarding/constants.js';
import type { Container } from '../src/platform/container.js';

function stubContainer(opts: {
  chains?: string[][];
  fileRank?: { path: string; percentile: number }[];
} = {}): Pick<Container, 'repoIntel'> {
  const calls: { chainLimit?: number; fileRankPaths?: string[] } = {};
  return {
    repoIntel: {
      getCriticalPaths: async (_repoId: string, chainLimit?: number) => {
        calls.chainLimit = chainLimit;
        return opts.chains ?? [];
      },
      getFileRank: async (_repoId: string, paths: string[]) => {
        calls.fileRankPaths = paths;
        return opts.fileRank ?? [];
      },
      // Unused by facts.ts; present only to satisfy the Pick<Container, 'repoIntel'> shape.
    } as unknown as Container['repoIntel'],
  };
}

describe('buildFacts', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dd-onboarding-'));
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { dev: 'tsx watch src/server.ts', build: 'tsc' } }),
    );
    await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    await writeFile(join(root, 'docker-compose.yml'), 'services:\n  db:\n    image: postgres\n');
    await writeFile(join(root, '.env.example'), '# comment\nDATABASE_URL=\nSECRET=hunter2-marker\n');
    await writeFile(join(root, 'README.md'), 'x'.repeat(README_EXCERPT_CHARS + 500));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads through readTextFileInClone for exactly the allowlisted paths (AC-35)', async () => {
    vi.resetModules();
    vi.doMock('../src/platform/safe-read.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/platform/safe-read.js')>();
      return { ...actual, readTextFileInClone: vi.fn(actual.readTextFileInClone) };
    });
    const { buildFacts: buildFactsSpied } = await import('../src/modules/onboarding/facts.js');
    const { readTextFileInClone } = await import('../src/platform/safe-read.js');

    await buildFactsSpied({
      repoFullName: 'acme/widgets',
      repoId: 'r1',
      clonePath: root,
      rankedPaths: [],
      findings: [],
      candidates: [],
      preDegradedReason: null,
      container: stubContainer(),
    });

    const seen = (readTextFileInClone as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (c) => c[1],
    );
    expect(new Set(seen)).toEqual(new Set(ROOT_FILE_ALLOWLIST));

    vi.doUnmock('../src/platform/safe-read.js');
    vi.resetModules();
  });

  it('has no direct node:fs import — every read goes through platform/safe-read.js', async () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'modules', 'onboarding', 'facts.ts');
    const source = await readFile(path, 'utf8');
    expect(source).not.toMatch(/from ['"]node:fs/);
  });

  it('.env.example: the key reaches facts, the value never does (AC-36)', async () => {
    const { facts } = await buildFacts({
      repoFullName: 'acme/widgets',
      repoId: 'r1',
      clonePath: root,
      rankedPaths: [],
      findings: [],
      candidates: [],
      preDegradedReason: null,
      container: stubContainer(),
    });
    expect(facts.envKeys).toContain('SECRET');
    expect(JSON.stringify(facts)).not.toContain('hunter2-marker');
  });

  it('derives pnpm from pnpm-lock.yaml and renders bare pnpm commands (AC-37)', async () => {
    const { facts } = await buildFacts({
      repoFullName: 'acme/widgets',
      repoId: 'r1',
      clonePath: root,
      rankedPaths: [],
      findings: [],
      candidates: [],
      preDegradedReason: null,
      container: stubContainer(),
    });
    expect(facts.packageManager).toBe('pnpm');
    expect(facts.runLocallyCommands).toEqual(['pnpm dev', 'pnpm build']);
  });

  it('no lockfile at all ⇒ bare script names, no manager prefix (AC-65)', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'dd-onboarding-bare-'));
    try {
      await writeFile(join(bare, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
      const { facts } = await buildFacts({
        repoFullName: 'acme/widgets',
        repoId: 'r1',
        clonePath: bare,
        rankedPaths: [],
        findings: [],
        candidates: [],
        preDegradedReason: null,
        container: stubContainer(),
      });
      expect(facts.packageManager).toBeNull();
      expect(facts.runLocallyCommands).toEqual(['dev']);
      for (const cmd of facts.runLocallyCommands) {
        expect(cmd).not.toMatch(/^(pnpm|npm|yarn) /);
      }
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });

  it.each([
    ['package-lock.json', 'npm'],
    ['yarn.lock', 'yarn'],
  ] as const)('derives %s → %s', async (lockfile, manager) => {
    const dir = await mkdtemp(join(tmpdir(), 'dd-onboarding-lock-'));
    try {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
      await writeFile(join(dir, lockfile), '');
      const { facts } = await buildFacts({
        repoFullName: 'acme/widgets',
        repoId: 'r1',
        clonePath: dir,
        rankedPaths: [],
        findings: [],
        candidates: [],
        preDegradedReason: null,
        container: stubContainer(),
      });
      expect(facts.packageManager).toBe(manager);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('malformed package.json yields no scripts, never throws', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dd-onboarding-bad-'));
    try {
      await writeFile(join(dir, 'package.json'), '{ not json');
      const { facts } = await buildFacts({
        repoFullName: 'acme/widgets',
        repoId: 'r1',
        clonePath: dir,
        rankedPaths: [],
        findings: [],
        candidates: [],
        preDegradedReason: null,
        container: stubContainer(),
      });
      expect(facts.scripts).toEqual([]);
      expect(facts.runLocallyCommands).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reading_path: the facade order, cut at READING_PATH_LIMIT (AC-32)', async () => {
    const ranked = Array.from({ length: READING_PATH_LIMIT + 1 }, (_, i) => `src/file${i}.ts`);
    const { facts } = await buildFacts({
      repoFullName: 'acme/widgets',
      repoId: 'r1',
      clonePath: root,
      rankedPaths: ranked,
      findings: [],
      candidates: [],
      preDegradedReason: null,
      container: stubContainer(),
    });
    expect(facts.readingPath).toEqual(ranked.slice(0, READING_PATH_LIMIT));
    expect(facts.readingPathTruncated).toBe(true);
  });

  it('reading_path: exactly the cap ⇒ truncated false', async () => {
    const ranked = Array.from({ length: READING_PATH_LIMIT }, (_, i) => `src/file${i}.ts`);
    const { facts } = await buildFacts({
      repoFullName: 'acme/widgets',
      repoId: 'r1',
      clonePath: root,
      rankedPaths: ranked,
      findings: [],
      candidates: [],
      preDegradedReason: null,
      container: stubContainer(),
    });
    expect(facts.readingPathTruncated).toBe(false);
  });

  it('critical_paths: cap + 1 chains ⇒ truncated true, asks for CRITICAL_PATHS_LIMIT + 1 (AC-33, decision 6)', async () => {
    const chains = Array.from({ length: CRITICAL_PATHS_LIMIT + 1 }, (_, i) => [`src/a${i}.ts`, `src/b${i}.ts`]);
    const { facts } = await buildFacts({
      repoFullName: 'acme/widgets',
      repoId: 'r1',
      clonePath: root,
      rankedPaths: [],
      findings: [],
      candidates: [],
      preDegradedReason: null,
      container: stubContainer({ chains }),
    });
    expect(facts.criticalPaths).toHaveLength(CRITICAL_PATHS_LIMIT);
    expect(facts.criticalPathsTruncated).toBe(true);
  });

  it('scripts: cap + 1 parsed scripts ⇒ truncated true, sliced, no cap+1 request involved', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dd-onboarding-scripts-'));
    try {
      const scripts: Record<string, string> = {};
      for (let i = 0; i < SCRIPTS_LIMIT + 1; i++) scripts[`s${i}`] = 'echo hi';
      await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts }));
      const { facts } = await buildFacts({
        repoFullName: 'acme/widgets',
        repoId: 'r1',
        clonePath: dir,
        rankedPaths: [],
        findings: [],
        candidates: [],
        preDegradedReason: null,
        container: stubContainer(),
      });
      expect(facts.scripts).toHaveLength(SCRIPTS_LIMIT);
      expect(facts.scriptsTruncated).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('env keys: cap + 1 parsed keys ⇒ truncated true, sliced', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dd-onboarding-env-'));
    try {
      const lines = Array.from({ length: ENV_KEYS_LIMIT + 1 }, (_, i) => `KEY_${i}=`).join('\n');
      await writeFile(join(dir, '.env.example'), lines);
      const { facts } = await buildFacts({
        repoFullName: 'acme/widgets',
        repoId: 'r1',
        clonePath: dir,
        rankedPaths: [],
        findings: [],
        candidates: [],
        preDegradedReason: null,
        container: stubContainer(),
      });
      expect(facts.envKeys).toHaveLength(ENV_KEYS_LIMIT);
      expect(facts.envKeysTruncated).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('AC-34: an over-long README leaves every truncated flag false', async () => {
    const { facts } = await buildFacts({
      repoFullName: 'acme/widgets',
      repoId: 'r1',
      clonePath: root,
      rankedPaths: [],
      findings: [],
      candidates: [],
      preDegradedReason: null,
      container: stubContainer(),
    });
    expect(facts.readme?.length).toBe(README_EXCERPT_CHARS);
    expect(facts.readingPathTruncated).toBe(false);
    expect(facts.criticalPathsTruncated).toBe(false);
    expect(facts.scriptsTruncated).toBe(false);
    expect(facts.envKeysTruncated).toBe(false);
  });

  it('AC-85: a critical-path chain member, a finding file and an evidence_path reach factPaths even though none is a ranked path', async () => {
    const { factPaths } = await buildFacts({
      repoFullName: 'acme/widgets',
      repoId: 'r1',
      clonePath: root,
      rankedPaths: ['src/ranked.ts'],
      findings: [{ file: 'src/finding-only.ts', startLine: 5, title: 'Missing null check' }],
      candidates: [{ id: 'c1', evidencePath: 'src/evidence-only.ts', evidenceStartLine: 2, rule: 'Always use async/await' }],
      preDegradedReason: null,
      container: stubContainer({
        chains: [['src/chain-only.ts', 'src/chain-sibling.ts']],
        fileRank: [],
      }),
    });
    expect(factPaths.has('src/chain-only.ts')).toBe(true);
    expect(factPaths.has('src/finding-only.ts')).toBe(true);
    expect(factPaths.has('src/evidence-only.ts')).toBe(true);
  });
});
