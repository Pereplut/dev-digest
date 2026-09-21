import { describe, it, expect } from 'vitest';
import { validateEvidence } from '../src/modules/conventions/proof.js';
import { MAX_EVIDENCE_LINES } from '../src/modules/conventions/constants.js';

/**
 * The proof step is what stops an invented convention reaching a skill, so each
 * rejection reason gets its own test. Pure over a string — no clone, no DB.
 */

const FILE = [
  'import { db } from "./db";', // 1
  '', // 2
  'export async function getUser(id: string) {', // 3
  '  const user = await db.users.find(id);', // 4
  '  const posts = await db.posts.findMany({ userId });', // 5
  '  return { user, posts };', // 6
  '}', // 7
].join('\n');

const claim = (over: Partial<Parameters<typeof validateEvidence>[1]> = {}) => ({
  evidencePath: 'src/api/users.ts',
  evidenceStartLine: 4,
  evidenceEndLine: 5,
  evidenceSnippet: 'const user = await db.users.find(id);',
  ...over,
});

describe('validateEvidence', () => {
  it('passes when the cited lines really contain the snippet', () => {
    const res = validateEvidence(FILE, claim());
    expect(res.ok).toBe(true);
  });

  it('returns the snippet re-read from the FILE, not the model\'s copy', () => {
    const res = validateEvidence(
      FILE,
      // The model reformatted the indentation and dropped a line.
      claim({ evidenceSnippet: 'const   user = await db.users.find(id);' }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Both cited lines come back, with the file's own leading whitespace.
    expect(res.snippet).toBe(
      '  const user = await db.users.find(id);\n  const posts = await db.posts.findMany({ userId });',
    );
  });

  it('tolerates whitespace differences', () => {
    const res = validateEvidence(FILE, claim({ evidenceSnippet: '  const    user  =  await db.users.find(id);  ' }));
    expect(res.ok).toBe(true);
  });

  it('rejects a file that does not exist', () => {
    const res = validateEvidence(null, claim());
    expect(res).toEqual({ ok: false, reason: 'file_not_found' });
  });

  it('rejects a line range past the end of the file', () => {
    const res = validateEvidence(FILE, claim({ evidenceStartLine: 99, evidenceEndLine: 105 }));
    expect(res).toEqual({ ok: false, reason: 'line_out_of_range' });
  });

  it('rejects an inverted range', () => {
    const res = validateEvidence(FILE, claim({ evidenceStartLine: 5, evidenceEndLine: 2 }));
    expect(res).toEqual({ ok: false, reason: 'line_out_of_range' });
  });

  it('rejects a snippet that is nowhere near the cited lines', () => {
    const res = validateEvidence(
      FILE,
      claim({ evidenceSnippet: 'export const redis = new Redis(config.redisUrl);' }),
    );
    expect(res).toEqual({ ok: false, reason: 'snippet_not_found' });
  });

  it('rejects an empty snippet — it proves nothing', () => {
    const res = validateEvidence(FILE, claim({ evidenceSnippet: '   \n  ' }));
    expect(res).toEqual({ ok: false, reason: 'snippet_not_found' });
  });

  it('accepts a small off-by-N within the slack window', () => {
    // Snippet is really on line 4; the model said 6.
    const res = validateEvidence(FILE, claim({ evidenceStartLine: 6, evidenceEndLine: 6 }));
    expect(res.ok).toBe(true);
  });

  it('rejects the same snippet once it falls outside the slack window', () => {
    const res = validateEvidence(FILE, claim({ evidenceStartLine: 7, evidenceEndLine: 7 }), 0);
    expect(res).toEqual({ ok: false, reason: 'snippet_not_found' });
  });

  /**
   * Regression: proof used to test each snippet line with `includes` against
   * any line in the window, so `}` — a substring of some line in nearly every
   * file — proved an invented rule and let it reach a skill body.
   */
  it.each([['}'], ['  }  '], ['const'], ['{'], [';'], ['return;']])(
    'rejects the trivial snippet %j, which matches almost any window',
    (snippet) => {
      const res = validateEvidence(FILE, claim({ evidenceSnippet: snippet }));
      expect(res).toEqual({ ok: false, reason: 'snippet_not_found' });
    },
  );

  it('rejects a snippet whose lines exist but in the wrong order', () => {
    const res = validateEvidence(
      FILE,
      claim({
        // Lines 5 then 4 — both real, but not the sequence that is in the file.
        evidenceSnippet: [
          'const posts = await db.posts.findMany({ userId });',
          'const user = await db.users.find(id);',
        ].join('\n'),
      }),
    );
    expect(res).toEqual({ ok: false, reason: 'snippet_not_found' });
  });

  it('rejects lines that are each present but not contiguous', () => {
    const res = validateEvidence(
      FILE,
      // Lines 3 and 5, skipping 4.
      claim({
        evidenceStartLine: 3,
        evidenceEndLine: 5,
        evidenceSnippet: [
          'export async function getUser(id: string) {',
          'const posts = await db.posts.findMany({ userId });',
        ].join('\n'),
      }),
    );
    expect(res).toEqual({ ok: false, reason: 'snippet_not_found' });
  });

  it('still accepts a real multi-line run, in order', () => {
    const res = validateEvidence(
      FILE,
      claim({
        evidenceStartLine: 4,
        evidenceEndLine: 5,
        evidenceSnippet: [
          'const user = await db.users.find(id);',
          'const posts = await db.posts.findMany({ userId });',
        ].join('\n'),
      }),
    );
    expect(res.ok).toBe(true);
  });

  it('clamps an end line that overruns the file rather than rejecting', () => {
    const res = validateEvidence(FILE, claim({ evidenceStartLine: 6, evidenceEndLine: 40 }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.endLine).toBe(7);
  });

  /**
   * Regression: only the START of the range was bounded. A candidate citing
   * 1–999999 made the search window the whole file, so one real line proved it
   * out and the stored snippet became the ENTIRE file — served to the browser
   * and merged into skill bodies that later review prompts carry.
   */
  it('refuses a cited range wider than MAX_EVIDENCE_LINES', () => {
    const big = Array.from({ length: 5_000 }, (_, i) => `const v${i} = ${i};`).join('\n');
    const res = validateEvidence(
      big,
      claim({
        evidenceStartLine: 1,
        evidenceEndLine: 999_999,
        // A real line, in the file, that would otherwise prove the claim.
        evidenceSnippet: 'const v4000 = 4000;',
      }),
    );
    expect(res).toEqual({ ok: false, reason: 'line_out_of_range' });
  });

  it('still proves a range at the limit', () => {
    const big = Array.from({ length: 5_000 }, (_, i) => `const v${i} = ${i};`).join('\n');
    const res = validateEvidence(
      big,
      claim({
        evidenceStartLine: 1,
        evidenceEndLine: MAX_EVIDENCE_LINES,
        evidenceSnippet: 'const v10 = 10;',
      }),
    );
    expect(res.ok).toBe(true);
  });
});
