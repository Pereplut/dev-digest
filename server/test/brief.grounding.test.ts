/**
 * Pure grounding + budget helpers (spec 0018, S4/S14). No Postgres, no
 * tokenizer adapter — `applyBudget`'s counter is injected.
 */
import { describe, it, expect } from 'vitest';
import type { BlastRadius, Risk, ReviewFocusItem } from '@devdigest/shared';
import {
  normalizePath,
  groundingPaths,
  groundBrief,
  buildFactBlocks,
  applyBudget,
  type BriefFactInput,
} from '../src/modules/brief/helpers.js';

const EMPTY_BLAST: BlastRadius = { changed_symbols: [], downstream: [], summary: 's' };

function risk(over: Partial<Risk> = {}): Risk {
  return {
    kind: 'security',
    title: 't',
    explanation: 'e',
    severity: 'medium',
    file_refs: ['src/a.ts'],
    ...over,
  };
}

function focus(over: Partial<ReviewFocusItem> = {}): ReviewFocusItem {
  return { file: 'src/a.ts', line: 1, reason: 'r', ...over };
}

describe('normalizePath (AC-11)', () => {
  it('strips one leading ./ and collapses repeated /', () => {
    expect(normalizePath('./src/a.ts')).toBe('src/a.ts');
    expect(normalizePath('src//a.ts')).toBe('src/a.ts');
    expect(normalizePath('src///a.ts')).toBe('src/a.ts');
  });

  it('compares the remainder case-sensitively (no case repair)', () => {
    expect(normalizePath('SRC/a.ts')).toBe('SRC/a.ts');
    expect(normalizePath('SRC/a.ts')).not.toBe(normalizePath('src/a.ts'));
  });
});

describe('groundingPaths (C13)', () => {
  it('unions PR files, changed-symbol files, downstream files and caller files', () => {
    const blast: BlastRadius = {
      changed_symbols: [{ name: 'f', file: 'src/sym.ts', kind: 'function' }],
      downstream: [
        {
          symbol: 'f',
          file: 'src/sym.ts',
          callers: [{ name: 'g', file: 'src/caller.ts', line: 3 }],
          endpoints_affected: [],
          crons_affected: [],
        },
      ],
      summary: 's',
    };
    const paths = groundingPaths([{ path: './src/pr-file.ts' }], blast);
    expect(paths).toEqual(
      new Set(['src/pr-file.ts', 'src/sym.ts', 'src/caller.ts']),
    );
  });
});

describe('groundBrief (AC-8, AC-9, AC-10, AC-11, AC-52)', () => {
  const paths = new Set(['src/a.ts', 'src/b.ts']);

  it('keeps a review-focus item whose file is grounded', () => {
    const out = groundBrief({ risks: [], review_focus: [focus({ file: 'src/a.ts' })] }, paths);
    expect(out.review_focus).toHaveLength(1);
    expect(out.dropped_focus).toBe(0);
  });

  it('drops a review-focus item whose file is invented', () => {
    const out = groundBrief(
      { risks: [], review_focus: [focus({ file: 'src/a.ts' }), focus({ file: 'src/invented.ts' })] },
      paths,
    );
    expect(out.review_focus).toEqual([focus({ file: 'src/a.ts' })]);
    expect(out.dropped_focus).toBe(1);
  });

  it('drops a review-focus item with line < 1 even when the file is grounded', () => {
    const out = groundBrief(
      { risks: [], review_focus: [focus({ line: 0 }), focus({ line: -3 }), focus({ line: 1 })] },
      paths,
    );
    expect(out.review_focus).toEqual([focus({ line: 1 })]);
    expect(out.dropped_focus).toBe(2);
  });

  it('accepts ./ and // normalisation, rejects a case mismatch', () => {
    const out = groundBrief(
      {
        risks: [],
        review_focus: [
          focus({ file: './src/a.ts' }),
          focus({ file: 'src//b.ts' }),
          focus({ file: 'SRC/a.ts' }),
        ],
      },
      paths,
    );
    expect(out.review_focus.map((f) => f.file)).toEqual(['./src/a.ts', 'src//b.ts']);
    expect(out.dropped_focus).toBe(1);
  });

  it('drops only the invented ref from a risk with one good and one invented file_ref', () => {
    const out = groundBrief(
      { risks: [risk({ file_refs: ['src/a.ts', 'src/invented.ts'] })], review_focus: [] },
      paths,
    );
    expect(out.risks).toEqual([risk({ file_refs: ['src/a.ts'] })]);
    expect(out.dropped_risks).toBe(0);
  });

  it('drops a risk entirely when every file_ref is invented', () => {
    const out = groundBrief(
      { risks: [risk({ file_refs: ['src/invented1.ts', 'src/invented2.ts'] })], review_focus: [] },
      paths,
    );
    expect(out.risks).toEqual([]);
    expect(out.dropped_risks).toBe(1);
  });

  it('leaves a fully-grounded risk untouched', () => {
    const fullyGrounded = risk({ file_refs: ['src/a.ts', 'src/b.ts'] });
    const out = groundBrief({ risks: [fullyGrounded], review_focus: [] }, paths);
    expect(out.risks).toEqual([fullyGrounded]);
    expect(out.dropped_risks).toBe(0);
  });

  it('empty files[] and empty blast map ground away every model-named path (AC-19)', () => {
    const emptyPaths = groundingPaths([], EMPTY_BLAST);
    const out = groundBrief(
      { risks: [risk()], review_focus: [focus()] },
      emptyPaths,
    );
    expect(out.risks).toEqual([]);
    expect(out.review_focus).toEqual([]);
  });
});

describe('buildFactBlocks + applyBudget (AC-4, AC-5)', () => {
  function facts(over: Partial<BriefFactInput> = {}): BriefFactInput {
    return {
      prBody: 'body',
      issueRef: '#12',
      specPaths: ['specs/0001-a.md'],
      files: [{ path: 'src/a.ts', additions: 1, deletions: 0 }],
      blastCallerLines: ['src/caller.ts:3 handler'],
      smartDiffLines: ['core: src/a.ts (+1/-0)'],
      ...over,
    };
  }

  it('omits a block whose input is empty', () => {
    const blocks = buildFactBlocks(facts({ specPaths: [], issueRef: null }));
    expect(blocks.map((b) => b.name)).toEqual(['smart_diff', 'blast_callers', 'pr_body', 'diff_stats']);
  });

  it('keeps every block under budget (small fixture)', () => {
    const blocks = buildFactBlocks(facts());
    const { kept, droppedNames } = applyBudget(blocks, 10, 8000, (t) => t.length);
    expect(kept).toHaveLength(blocks.length);
    expect(droppedNames).toEqual([]);
  });

  it('drops whole blocks, lowest priority first, until the total fits', () => {
    const blocks = buildFactBlocks(facts());
    // Each block's "tokens" = its text length here, so a tiny limit forces drops
    // in TRUNCATION_ORDER: specs -> smart_diff -> blast_callers -> issue -> pr_body -> diff_stats.
    const { kept, droppedNames } = applyBudget(blocks, 0, 5, (t) => t.length);
    expect(droppedNames[0]).toBe('specs');
    expect(kept.find((b) => b.name === 'specs')).toBeUndefined();
  });

  it('never reports a block as dropped if it was never present', () => {
    const blocks = buildFactBlocks(facts({ issueRef: null }));
    const { droppedNames } = applyBudget(blocks, 0, 0, (t) => t.length);
    expect(droppedNames).not.toContain('issue');
  });
});
