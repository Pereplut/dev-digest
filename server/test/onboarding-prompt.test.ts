/**
 * Onboarding system prompt (spec 0017).
 *
 * This file grows in two steps: C2 (S6) asserts the static template's shape
 * (AC-68, AC-80, AC-81); C4 (S18) adds the assembled-message assertions
 * (AC-41, AC-42) once `prompt.ts` exists.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'prompts',
  'onboarding.system.md',
);

const KIND_NAMES = ['architecture', 'critical_paths', 'run_locally', 'reading_path', 'first_tasks'];

/** Backticked spans ending in `/*` — the AC-80 counter-example, and nothing else. */
function countGlobTokens(text: string): number {
  return (text.match(/`[^`]*\/\*`/g) ?? []).length;
}

describe('onboarding.system.md', () => {
  it('names exactly the five section kinds and never routes_and_apis (AC-68)', async () => {
    const text = await readFile(PROMPT_PATH, 'utf8');
    for (const kind of KIND_NAMES) {
      expect(text).toContain(kind);
    }
    expect(text).not.toContain('routes_and_apis');
  });

  it('instructs exact-path citation and names the directory-glob form as rejected (AC-80)', async () => {
    const text = await readFile(PROMPT_PATH, 'utf8');
    expect(text.toLowerCase()).toContain('exact');
    expect(text).toContain('src/api/*');
    expect(text.toLowerCase()).toMatch(/not accepted|rejected|not allowed/);
  });

  it('contains exactly one backticked token ending in /* (AC-81)', async () => {
    const text = await readFile(PROMPT_PATH, 'utf8');
    expect(countGlobTokens(text)).toBe(1);
  });

  it('is not vacuous: a second glob token would fail the count assertion', async () => {
    const text = await readFile(PROMPT_PATH, 'utf8');
    const withSecondGlob = text.replace(
      'Keep it skimmable',
      'See also `src/other/*` for context. Keep it skimmable',
    );
    expect(countGlobTokens(withSecondGlob)).toBe(2);
  });
});
