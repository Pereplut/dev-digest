import { describe, it, expect } from 'vitest';
import type { PromptAssembledInfo } from '@devdigest/reviewer-core';
import { loadConfig } from '../src/platform/config.js';
import {
  logPromptAssembled,
  memoizeCount,
  digestText,
  type PromptLogContext,
} from '../src/platform/prompt-log.js';

/**
 * The server half of prompt-assembly logging (spec 0008): the local-only
 * verbose gate, the sink's source labels + redaction, and the invariant the
 * whole design rests on — no section TEXT reaches a log record, ever.
 */
describe('prompt logging', () => {
  /** Captures pino calls; only `debug` should ever be used by the sink. */
  function fakeLog() {
    const calls: { level: string; obj: unknown; msg?: string }[] = [];
    const push = (level: string) => (obj: unknown, msg?: string) => calls.push({ level, obj, msg });
    return {
      calls,
      log: { info: push('info'), warn: push('warn'), error: push('error'), debug: push('debug') },
    };
  }

  const ctx: PromptLogContext = {
    runId: 'run-1',
    prId: 'pr-1',
    agent: 'security',
    provider: 'openai',
    model: 'gpt-4.1',
  };

  function info(over: Partial<PromptAssembledInfo> = {}): PromptAssembledInfo {
    return {
      mode: 'single-pass',
      chunk: { index: 1, of: 1, label: 'all files' },
      totals: { chars: 100, tokens: 25 },
      sections: [
        { name: 'system', chars: 40, tokens: 10 },
        { name: 'diff', chars: 60, tokens: 15 },
      ],
      ...over,
    };
  }

  describe('verbose is development-only', () => {
    const cases: { nodeEnv: string; flag: string | undefined; verbose: boolean; ignored: boolean }[] = [
      { nodeEnv: 'development', flag: 'true', verbose: true, ignored: false },
      { nodeEnv: 'development', flag: 'false', verbose: false, ignored: false },
      { nodeEnv: 'development', flag: undefined, verbose: false, ignored: false },
      { nodeEnv: 'production', flag: 'true', verbose: false, ignored: true },
      { nodeEnv: 'test', flag: 'true', verbose: false, ignored: true },
      { nodeEnv: 'production', flag: undefined, verbose: false, ignored: false },
    ];

    for (const c of cases) {
      it(`NODE_ENV=${c.nodeEnv} PROMPT_LOG_VERBOSE=${c.flag ?? '(unset)'} → ${c.verbose}`, () => {
        const config = loadConfig({
          NODE_ENV: c.nodeEnv,
          ...(c.flag !== undefined ? { PROMPT_LOG_VERBOSE: c.flag } : {}),
        } as NodeJS.ProcessEnv);

        expect(config.promptLogVerbose).toBe(c.verbose);
        // Set-but-refused must be distinguishable from never-set, so boot can warn.
        expect(config.promptLogVerboseIgnored).toBe(c.ignored);
      });
    }
  });

  describe('promptLogEnabled follows the log level', () => {
    const cases: [string | undefined, string, boolean][] = [
      ['debug', 'development', true],
      ['trace', 'development', true],
      ['info', 'development', false],
      ['silent', 'development', false],
      [undefined, 'development', false], // defaults to info
      [undefined, 'test', false], // defaults to silent
    ];

    for (const [level, nodeEnv, enabled] of cases) {
      it(`LOG_LEVEL=${level ?? '(unset)'} NODE_ENV=${nodeEnv} → ${enabled}`, () => {
        const config = loadConfig({
          NODE_ENV: nodeEnv,
          ...(level !== undefined ? { LOG_LEVEL: level } : {}),
        } as NodeJS.ProcessEnv);
        expect(config.promptLogEnabled).toBe(enabled);
      });
    }
  });

  it('emits one debug record with a source label per section', () => {
    const { log, calls } = fakeLog();
    logPromptAssembled(log, ctx, info());

    expect(calls).toHaveLength(1);
    expect(calls[0]!.level).toBe('debug');
    expect(calls[0]!.msg).toBe('prompt assembled');

    const rec = calls[0]!.obj as Record<string, unknown>;
    expect(rec.runId).toBe('run-1');
    expect(rec.mode).toBe('single-pass');
    expect(rec.sections).toEqual([
      { name: 'system', source: 'db:agents.system_prompt', chars: 40, tokens: 10 },
      { name: 'diff', source: 'git:diff-loader', chars: 60, tokens: 15 },
    ]);
  });

  it('omits absent sections instead of reporting them as zero', () => {
    const { log, calls } = fakeLog();
    logPromptAssembled(log, ctx, info());

    const names = (calls[0]!.obj as { sections: { name: string }[] }).sections.map((s) => s.name);
    expect(names).toEqual(['system', 'diff']);
    expect(names).not.toContain('repo_map');
  });

  it('adds order, hashes and the skill breakdown only in verbose', () => {
    const sections = [
      { name: 'system' as const, chars: 40, tokens: 10, digest: 'abc123abc123' },
      { name: 'skills' as const, chars: 20, tokens: 5, count: 2, digest: 'def456def456' },
    ];
    const skills = [
      { name: 'no-then-chains', chars: 12, tokens: 3 },
      { name: 'naming', chars: 8, tokens: 2 },
    ];

    const plain = fakeLog();
    logPromptAssembled(plain.log, ctx, info({ sections }), { verbose: false, skills });
    const plainRec = plain.calls[0]!.obj as Record<string, unknown>;
    expect(plainRec.order).toBeUndefined();
    expect(plainRec.skillBreakdown).toBeUndefined();

    const verbose = fakeLog();
    logPromptAssembled(verbose.log, ctx, info({ sections }), { verbose: true, skills });
    const rec = verbose.calls[0]!.obj as Record<string, unknown>;
    expect(rec.order).toEqual(['system', 'skills']);
    expect(rec.skillBreakdown).toEqual(skills);
    expect((rec.sections as { digest?: string }[])[0]!.digest).toBe('abc123abc123');
  });

  it('redacts credentials in the chunk label and the model id', () => {
    const { log, calls } = fakeLog();
    logPromptAssembled(
      log,
      { ...ctx, model: 'proxy https://user:ghp_secrettoken@example.com/v1' },
      info({ chunk: { index: 1, of: 1, label: 'https://x-access-token:ghp_leak@github.com/a/b.ts' } }),
    );

    const rec = calls[0]!.obj as { model: string; chunk: { label: string } };
    expect(rec.model).not.toContain('ghp_secrettoken');
    expect(rec.model).toContain('***@');
    expect(rec.chunk.label).not.toContain('ghp_leak');
    expect(rec.chunk.label).toContain('***@');
  });

  it('never carries section text — a canary in every field stays out of the record', () => {
    const canary = 'CANARY_SECRET_STRING';
    const { log, calls } = fakeLog();

    // Worst case: the canary is in the content of every section AND the sink is
    // verbose. Only sizes and hashes may survive.
    logPromptAssembled(
      log,
      ctx,
      info({
        sections: [
          { name: 'system', chars: canary.length, tokens: 5, digest: digestText(canary) },
          { name: 'diff', chars: canary.length, tokens: 5, digest: digestText(canary) },
          { name: 'pr_description', chars: canary.length, tokens: 5, truncated: true },
          { name: 'specs', chars: canary.length, count: 1 },
        ],
      }),
      { verbose: true, skills: [{ name: 'a-skill', chars: 10, tokens: 2 }] },
    );

    expect(JSON.stringify(calls[0])).not.toContain(canary);
  });

  it('digestText is stable, short, and not reversible to the input', () => {
    const d = digestText('some prompt section');
    expect(d).toBe(digestText('some prompt section'));
    expect(d).not.toBe(digestText('some prompt section!'));
    expect(d).toHaveLength(12);
    expect(d).toMatch(/^[0-9a-f]{12}$/);
  });

  it('memoizeCount tokenizes each distinct section once', () => {
    let calls = 0;
    const count = memoizeCount((t) => {
      calls += 1;
      return t.length;
    });

    // The map-reduce shape: a static system prompt re-measured per chunk, and a
    // different diff slice each time.
    expect(count('system prompt')).toBe(13);
    expect(count('system prompt')).toBe(13);
    expect(count('system prompt')).toBe(13);
    expect(calls).toBe(1);

    count('diff chunk a');
    count('diff chunk b');
    expect(calls).toBe(3);
  });
});
