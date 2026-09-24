import { describe, it, expect } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';
import { MockLLMProvider } from '../../server/src/adapters/mocks.js';
import { reviewPullRequest, type PromptAssembledInfo } from '../src/index.js';

/**
 * The `onPromptAssembled` sink (spec 0008) — prompt-composition observability.
 *
 * The point of these tests is the map-reduce case: `ReviewOutcome.assembly`
 * holds a whole-diff assembly that is never sent, so a consumer reading it
 * would report one prompt for an N-call run. The sink must fire per CALL.
 */
describe('onPromptAssembled', () => {
  const clean = { verdict: 'approve', summary: 'ok', score: 100, findings: [] };

  /** A minimal but realistically-shaped file entry `sliceDiff` can cut on. */
  function file(path: string, added: string) {
    return {
      raw: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,2 @@\n context\n+${added}`,
      entry: {
        path,
        additions: 1,
        deletions: 0,
        hunks: [{ file: path, oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, newLineNumbers: [2] }],
      },
    };
  }

  function diffOf(...paths: string[]): UnifiedDiff {
    const parts = paths.map((p, i) => file(p, `const v${i} = ${i};`));
    return { raw: parts.map((p) => p.raw).join('\n'), files: parts.map((p) => p.entry) };
  }

  async function run(input: Partial<Parameters<typeof reviewPullRequest>[0]> & { diff: UnifiedDiff }) {
    const seen: PromptAssembledInfo[] = [];
    await reviewPullRequest({
      systemPrompt: 'security reviewer',
      model: 'gpt-4.1',
      llm: new MockLLMProvider('openai', { structured: clean }),
      onPromptAssembled: (i) => seen.push(i),
      ...input,
    });
    return seen;
  }

  it('fires once per LLM call in map-reduce — not once per run', async () => {
    const paths = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    const seen = await run({ diff: diffOf(...paths), strategy: 'map-reduce' });

    expect(seen).toHaveLength(3);
    expect(seen.map((s) => s.chunk.label)).toEqual(paths);
    expect(seen.map((s) => s.chunk.index)).toEqual([1, 2, 3]);
    expect(seen.every((s) => s.chunk.of === 3)).toBe(true);
    expect(seen.every((s) => s.mode === 'map-reduce')).toBe(true);
  });

  it('gives each map-reduce call its own diff size (not the whole-diff one)', async () => {
    const seen = await run({ diff: diffOf('src/a.ts', 'src/bbbbbbbbbbbbbbbb.ts'), strategy: 'map-reduce' });
    const diffChars = seen.map((s) => s.sections.find((x) => x.name === 'diff')!.chars);

    // Per-file slices, so they differ from each other and each is smaller than
    // the whole diff — the exact failure a run-level record would hide.
    expect(diffChars[0]).not.toBe(diffChars[1]);
    const whole = diffOf('src/a.ts', 'src/bbbbbbbbbbbbbbbb.ts').raw.length;
    expect(diffChars.every((c) => c < whole)).toBe(true);
  });

  it('fires exactly once in single-pass', async () => {
    const seen = await run({ diff: diffOf('src/a.ts', 'src/b.ts'), strategy: 'single-pass' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.mode).toBe('single-pass');
    expect(seen[0]!.chunk).toEqual({ index: 1, of: 1, label: 'all files' });
  });

  it('omits absent sections rather than reporting them empty', async () => {
    const seen = await run({ diff: diffOf('src/a.ts'), strategy: 'single-pass' });
    const names = seen[0]!.sections.map((s) => s.name);

    expect(names).toEqual(['system', 'diff']);
    expect(names).not.toContain('repo_map');
    expect(names).not.toContain('callers');
    expect(names).not.toContain('specs');
    expect(names).not.toContain('memory');
  });

  it('reports each supplied section once, in render order, with counts', async () => {
    const seen = await run({
      diff: diffOf('src/a.ts'),
      strategy: 'single-pass',
      task: 'Review PR #482',
      skills: ['### Skill: no-then-chains\nbody', '### Skill: naming\nbody'],
      memory: ['m1', 'm2', 'm3'],
      specs: ['spec one'],
      repoMap: 'src/a.ts: foo()',
      callers: '### src/b.ts\n- `foo` — foo(): void',
      prDescription: 'adds a thing',
    });
    const sections = seen[0]!.sections;

    expect(sections.map((s) => s.name)).toEqual([
      'system',
      'skills',
      'task',
      'pr_description',
      'memory',
      'repo_map',
      'specs',
      'callers',
      'diff',
    ]);
    expect(sections.find((s) => s.name === 'skills')!.count).toBe(2);
    expect(sections.find((s) => s.name === 'memory')!.count).toBe(3);
    expect(sections.find((s) => s.name === 'repo_map')!.chars).toBe('src/a.ts: foo()'.length);
  });

  it('flags a truncated PR description and reports the capped size', async () => {
    const seen = await run({
      diff: diffOf('src/a.ts'),
      strategy: 'single-pass',
      prDescription: 'x'.repeat(5000),
    });
    const pr = seen[0]!.sections.find((s) => s.name === 'pr_description')!;

    expect(pr.truncated).toBe(true);
    expect(pr.chars).toBe(4000);

    const short = await run({
      diff: diffOf('src/a.ts'),
      strategy: 'single-pass',
      prDescription: 'short',
    });
    expect(short[0]!.sections.find((s) => s.name === 'pr_description')!.truncated).toBeUndefined();
  });

  it('carries no section text — a canary in every untrusted slot never appears', async () => {
    const canary = 'CANARY_SECRET_STRING';
    const seen = await run({
      diff: { ...diffOf('src/a.ts'), raw: `diff --git a/src/a.ts b/src/a.ts\n+const k = "${canary}";` },
      strategy: 'single-pass',
      systemPrompt: `reviewer ${canary}`,
      task: `Review ${canary}`,
      skills: [`### Skill: s\n${canary}`],
      memory: [canary],
      specs: [canary],
      repoMap: canary,
      callers: canary,
      prDescription: canary,
    });

    expect(JSON.stringify(seen)).not.toContain(canary);
  });

  it('reports tokens only when a counter is injected', async () => {
    const without = await run({ diff: diffOf('src/a.ts'), strategy: 'single-pass' });
    expect(without[0]!.sections.every((s) => s.tokens === undefined)).toBe(true);
    expect(without[0]!.totals.tokens).toBeUndefined();

    // A stand-in for the server's tiktoken adapter: 1 token per 4 chars.
    const seen = await run({
      diff: diffOf('src/a.ts'),
      strategy: 'single-pass',
      countTokens: (t) => Math.ceil(t.length / 4),
    });
    const sections = seen[0]!.sections;

    expect(sections.every((s) => typeof s.tokens === 'number')).toBe(true);
    expect(sections.find((s) => s.name === 'system')!.tokens).toBe(
      Math.ceil('security reviewer'.length / 4),
    );
    expect(seen[0]!.totals.tokens).toBeGreaterThan(
      sections.reduce((n, s) => n + s.tokens!, 0) - sections.length,
    );
  });

  it('never calls the injected counter when it was not supplied', async () => {
    // The counter is the expensive part on a big map-reduce run, so "not passed"
    // has to mean "not called" — not "called and discarded".
    let calls = 0;
    await run({
      diff: diffOf('src/a.ts', 'src/b.ts', 'src/c.ts'),
      strategy: 'map-reduce',
      countTokens: (t) => {
        calls += 1;
        return t.length;
      },
    });
    const withCounter = calls;
    calls = 0;
    await run({ diff: diffOf('src/a.ts', 'src/b.ts', 'src/c.ts'), strategy: 'map-reduce' });

    expect(withCounter).toBeGreaterThan(0);
    expect(calls).toBe(0);
  });

  it('totals exceed the section sum by the assembly framing', async () => {
    const seen = await run({ diff: diffOf('src/a.ts'), strategy: 'single-pass', task: 'Review' });
    const info = seen[0]!;
    const sum = info.sections.reduce((n, s) => n + s.chars, 0);

    // The delta is the injection guard + `## ` headers + <untrusted> delimiters.
    expect(info.totals.chars).toBeGreaterThan(sum);
  });
});
