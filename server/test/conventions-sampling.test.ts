import { describe, it, expect } from 'vitest';
import {
  buildSampleBlock,
  isWalkJunk,
  pickSamplePaths,
  walkFallbackPaths,
} from '../src/modules/conventions/sampling.js';
import { TOP_FILE_COUNT } from '../src/modules/conventions/constants.js';
import {
  conventionFingerprint,
  dedupeByFingerprint,
  isSafeRelativePath,
  normalizeRule,
} from '../src/modules/conventions/helpers.js';

/** Homework criterion 39: sample picking is pure code, with no model involved. */
describe('pickSamplePaths', () => {
  it('puts configs first, then the ranked files', () => {
    const out = pickSamplePaths(
      ['tsconfig.json', '.prettierrc'],
      ['src/api/users.ts', 'src/lib/redis.ts'],
    );
    expect(out).toEqual(['tsconfig.json', '.prettierrc', 'src/api/users.ts', 'src/lib/redis.ts']);
  });

  it(`caps the ranked files at ${TOP_FILE_COUNT}`, () => {
    const ranked = Array.from({ length: 30 }, (_, i) => `src/f${i}.ts`);
    const out = pickSamplePaths([], ranked);
    expect(out).toHaveLength(TOP_FILE_COUNT);
    expect(out.at(-1)).toBe(`src/f${TOP_FILE_COUNT - 1}.ts`);
  });

  it('de-duplicates a path that is both a config and ranked', () => {
    const out = pickSamplePaths(['package.json'], ['package.json', 'src/a.ts']);
    expect(out).toEqual(['package.json', 'src/a.ts']);
  });
});

describe('walkFallbackPaths', () => {
  it('keeps only source extensions', () => {
    const out = walkFallbackPaths(['README.md', 'src/a.ts', 'logo.png', 'src/b.tsx']);
    expect(out).toEqual(['src/a.ts', 'src/b.tsx']);
  });

  it('drops tests, declarations and migrations', () => {
    const out = walkFallbackPaths([
      'src/a.ts',
      'src/a.test.ts',
      'src/types.d.ts',
      'src/db/migrations/0001_x.ts',
      'src/__tests__/b.ts',
    ]);
    expect(out).toEqual(['src/a.ts']);
  });

  it('is deterministic: shallowest, then shortest, then alphabetical', () => {
    const input = ['src/deep/nested/z.ts', 'src/bb.ts', 'src/a.ts', 'index.ts'];
    expect(walkFallbackPaths(input)).toEqual([
      'index.ts',
      'src/a.ts',
      'src/bb.ts',
      'src/deep/nested/z.ts',
    ]);
    // Same set in a different order gives the same answer.
    expect(walkFallbackPaths([...input].reverse())).toEqual(walkFallbackPaths(input));
  });

  it('respects the limit', () => {
    const paths = Array.from({ length: 40 }, (_, i) => `src/f${i}.ts`);
    expect(walkFallbackPaths(paths)).toHaveLength(TOP_FILE_COUNT);
  });

  it('flags junk paths', () => {
    expect(isWalkJunk('src/a.test.ts')).toBe(true);
    expect(isWalkJunk('src/a.ts')).toBe(false);
  });
});

describe('buildSampleBlock', () => {
  it('numbers lines from 1 so the model can cite them', () => {
    const block = buildSampleBlock([{ path: 'src/a.ts', content: 'const a = 1;\nconst b = 2;' }]);
    expect(block).toContain('--- src/a.ts ---');
    expect(block).toContain('1\tconst a = 1;');
    expect(block).toContain('2\tconst b = 2;');
  });

  it('truncates a long file and says so, so no line past the cut is cited', () => {
    const content = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
    const block = buildSampleBlock([{ path: 'src/big.ts', content }], 100_000, 10);
    expect(block).toContain('10\tline 10');
    expect(block).not.toContain('11\tline 11');
    expect(block).toContain('truncated, 40 more lines');
  });

  it('stops adding files once the character budget is spent', () => {
    const files = [
      { path: 'a.ts', content: 'x'.repeat(200) },
      { path: 'b.ts', content: 'y'.repeat(200) },
    ];
    const block = buildSampleBlock(files, 260);
    expect(block).toContain('--- a.ts ---');
    expect(block).not.toContain('--- b.ts ---');
  });
});

describe('conventionFingerprint', () => {
  it('collapses case, whitespace and trailing punctuation to one identity', () => {
    const a = conventionFingerprint('src/a.ts', 'Always use async/await instead of .then() chains.');
    const b = conventionFingerprint('src/a.ts', 'always  use ASYNC/AWAIT instead of .then() chains');
    expect(a).toBe(b);
  });

  it('separates the same rule found in a different file', () => {
    const a = conventionFingerprint('src/a.ts', 'Use async/await');
    const b = conventionFingerprint('src/b.ts', 'Use async/await');
    expect(a).not.toBe(b);
  });

  it('separates genuinely different rules', () => {
    expect(conventionFingerprint('src/a.ts', 'Use async/await')).not.toBe(
      conventionFingerprint('src/a.ts', 'Use Result types'),
    );
  });

  it('normalizeRule is the documented normalisation', () => {
    expect(normalizeRule('  Always   Do This!! ')).toBe('always do this');
  });
});

/**
 * Two rows sharing a fingerprint in one INSERT … ON CONFLICT DO UPDATE abort the
 * whole statement (SQLSTATE 21000), which would fail the entire scan.
 */
describe('dedupeByFingerprint', () => {
  const row = (over: Partial<{ fingerprint: string; confidence: number; evidenceValid: boolean }> = {}) => ({
    fingerprint: 'f1',
    confidence: 0.5,
    evidenceValid: true,
    ...over,
  });

  it('keeps one row per fingerprint', () => {
    const out = dedupeByFingerprint([row(), row(), row({ fingerprint: 'f2' })]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.fingerprint).sort()).toEqual(['f1', 'f2']);
  });

  it('prefers the proved candidate over an unproved duplicate, whatever the order', () => {
    const proved = row({ evidenceValid: true, confidence: 0.1 });
    const unproved = row({ evidenceValid: false, confidence: 0.99 });
    expect(dedupeByFingerprint([unproved, proved])[0]).toBe(proved);
    expect(dedupeByFingerprint([proved, unproved])[0]).toBe(proved);
  });

  it('breaks a tie on confidence', () => {
    const low = row({ confidence: 0.3 });
    const high = row({ confidence: 0.9 });
    expect(dedupeByFingerprint([low, high])[0]).toBe(high);
    expect(dedupeByFingerprint([high, low])[0]).toBe(high);
  });

  it('collapses the near-identical phrasings the fingerprint normalises together', () => {
    const a = { ...row(), fingerprint: conventionFingerprint('src/a.ts', 'Use async/await.') };
    const b = { ...row(), fingerprint: conventionFingerprint('src/a.ts', 'use  ASYNC/AWAIT') };
    expect(dedupeByFingerprint([a, b])).toHaveLength(1);
  });

  it('passes an empty list through', () => {
    expect(dedupeByFingerprint([])).toEqual([]);
  });
});

describe('isSafeRelativePath', () => {
  it.each([
    ['src/a.ts', true],
    ['tsconfig.json', true],
    ['../../etc/passwd', false],
    ['/etc/passwd', false],
    ['..', false],
    ['', false],
  ])('%s → %s', (path, expected) => {
    expect(isSafeRelativePath(path)).toBe(expected);
  });
});
