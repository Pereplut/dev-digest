/**
 * `buildSmartDiff` is the whole route minus I/O, so it is tested here without
 * Postgres. The route's own test only has to prove tenancy and the wiring.
 */
import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import { buildSmartDiff } from '../src/modules/smart-diff/helpers.js';

const FILES = [
  { path: 'pnpm-lock.yaml', additions: 92, deletions: 24 },
  { path: 'server/src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
  { path: 'server/test/ratelimit.test.ts', additions: 30, deletions: 0 },
  { path: 'server/src/index.ts', additions: 12, deletions: 2 },
  { path: 'README.md', additions: 4, deletions: 1 },
];

describe('buildSmartDiff', () => {
  it('emits groups in display order, whatever order the files arrive in', () => {
    const { groups } = buildSmartDiff(FILES, []);
    expect(groups.map((g) => g.role)).toEqual(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
  });

  it('omits empty groups rather than showing an empty header', () => {
    const { groups } = buildSmartDiff([{ path: 'src/a.ts', additions: 1, deletions: 0 }], []);
    expect(groups.map((g) => g.role)).toEqual(['core']);
  });

  it('keeps GitHub order within a group, so "Original order" is a re-flattening', () => {
    const { groups } = buildSmartDiff(
      [
        { path: 'src/z.ts', additions: 1, deletions: 0 },
        { path: 'src/a.ts', additions: 1, deletions: 0 },
      ],
      [],
    );
    expect(groups[0]!.files.map((f) => f.path)).toEqual(['src/z.ts', 'src/a.ts']);
  });

  it('attaches finding lines to the right file, deduped and ascending', () => {
    const { groups } = buildSmartDiff(FILES, [
      { file: 'server/src/middleware/ratelimit.ts', startLine: 52 },
      { file: 'server/src/middleware/ratelimit.ts', startLine: 28 },
      { file: 'server/src/middleware/ratelimit.ts', startLine: 52 },
    ]);
    const core = groups.find((g) => g.role === 'core')!;
    expect(core.files[0]!.finding_lines).toEqual([28, 52]);
    const docs = groups.find((g) => g.role === 'docs')!;
    expect(docs.files[0]!.finding_lines).toEqual([]);
  });

  it('matches a finding whose path carries a leading ./', () => {
    const { groups } = buildSmartDiff(
      [{ path: 'server/src/a.ts', additions: 1, deletions: 0 }],
      [{ file: './server/src/a.ts', startLine: 7 }],
    );
    expect(groups[0]!.files[0]!.finding_lines).toEqual([7]);
  });

  it('ignores a finding on a file that is not in the diff', () => {
    const { groups } = buildSmartDiff(
      [{ path: 'server/src/a.ts', additions: 1, deletions: 0 }],
      [{ file: 'server/src/elsewhere.ts', startLine: 7 }],
    );
    expect(groups[0]!.files[0]!.finding_lines).toEqual([]);
  });

  it('sums total_lines over additions and deletions and never suggests a split', () => {
    expect(buildSmartDiff(FILES, []).split_suggestion).toEqual({
      too_big: false,
      total_lines: 249,
      proposed_splits: [],
    });
  });

  it('treats null additions/deletions as zero', () => {
    const { groups, split_suggestion } = buildSmartDiff(
      [{ path: 'src/a.ts', additions: null, deletions: null }],
      [],
    );
    expect(groups[0]!.files[0]).toMatchObject({ additions: 0, deletions: 0 });
    expect(split_suggestion.total_lines).toBe(0);
  });

  it('returns an empty but valid payload when the PR has no files yet', () => {
    const out = buildSmartDiff([], []);
    expect(out.groups).toEqual([]);
    expect(out.split_suggestion.total_lines).toBe(0);
  });

  it('produces a payload the contract accepts', () => {
    // AC 8: the route's response must validate against SmartDiff.
    expect(() => SmartDiff.parse(buildSmartDiff(FILES, [
      { file: 'server/src/middleware/ratelimit.ts', startLine: 28 },
    ]))).not.toThrow();
  });
});
