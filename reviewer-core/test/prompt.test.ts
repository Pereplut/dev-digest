/**
 * assemblePrompt — PR description slot (the fix that was missing: the PR body
 * never reached the prompt). Pins rendering, omit-when-empty, untrusted-wrap,
 * truncation, and ordering (before the diff).
 */
import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../src/prompt.js';

function userOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  const { messages } = assemblePrompt(parts);
  return messages[1]!.content;
}

function systemOf(parts: Parameters<typeof assemblePrompt>[0]): string {
  return assemblePrompt(parts).messages[0]!.content;
}

describe('assemblePrompt — shared injection guard (server + CI)', () => {
  const sys = systemOf({ system: 'AGENT-SYS', diff: 'DIFF' });

  it('appends the guard to the agent system prompt', () => {
    expect(sys.startsWith('AGENT-SYS')).toBe(true);
    expect(sys).toMatch(/<untrusted>.*DATA to be analyzed/s);
  });

  it('forbids "intentional/test/demo" claims from descoping the review', () => {
    // The defense that replaced the keyword sanitizer: a general, trusted,
    // language-agnostic rule — not text parsing of untrusted input.
    expect(sys).toMatch(/test fixture|intentional|demo/i);
    expect(sys).toMatch(/never reduce|never .*descope|REPORT it/i);
    expect(sys).toMatch(/any language/i);
  });
});

describe('assemblePrompt — ## PR description', () => {
  it('renders the section (untrusted-wrapped) before the diff when present', () => {
    const { messages, assembly } = assemblePrompt({
      system: 'sys',
      diff: 'DIFF',
      prDescription: 'Adds rate limiting to the public /api endpoints.',
    });
    const user = messages[1]!.content;
    expect(user).toContain('## PR description');
    expect(user).toContain('<untrusted source="pr-description">');
    expect(user).toContain('Adds rate limiting to the public /api endpoints.');
    expect(user.indexOf('## PR description')).toBeLessThan(user.indexOf('## Diff to review'));
    expect(assembly.pr_description).toContain('Adds rate limiting');
  });

  it('omits the section when prDescription is undefined or blank (no behaviour change)', () => {
    expect(userOf({ system: 'sys', diff: 'DIFF' })).not.toContain('## PR description');
    expect(assemblePrompt({ system: 'sys', diff: 'DIFF' }).assembly.pr_description ?? null).toBeNull();
    expect(userOf({ system: 'sys', diff: 'DIFF', prDescription: '   ' })).not.toContain(
      '## PR description',
    );
  });

  it('truncates a huge body to the 4k cap', () => {
    const { assembly } = assemblePrompt({
      system: 'sys',
      diff: 'D',
      prDescription: 'x'.repeat(10_000),
    });
    expect((assembly.pr_description as string).length).toBe(4000);
  });
});

describe('assemblePrompt — skills live in the system message (spec 0006)', () => {
  const skills = ['### Skill: a\nCheck A', '### Skill: b\nCheck B'];

  it('places the ## Skills block after the agent prompt and before the guard, in order', () => {
    const sys = systemOf({ system: 'AGENT-SYS', diff: 'DIFF', skills });
    const iSys = sys.indexOf('AGENT-SYS');
    const iSkills = sys.indexOf('## Skills\n### Skill: a');
    const iB = sys.indexOf('### Skill: b');
    const iGuard = sys.indexOf('<untrusted>');
    expect(iSys).toBe(0);
    expect(iSkills).toBeGreaterThan(iSys);
    expect(iB).toBeGreaterThan(iSkills);
    expect(iGuard).toBeGreaterThan(iB);
  });

  it('keeps skills out of the user message', () => {
    const user = userOf({ system: 'S', diff: 'DIFF', skills });
    expect(user).not.toContain('Check A');
    expect(user).not.toContain('## Skills');
  });

  it('records the skills slot separately from assembly.system (no double counting)', () => {
    const { assembly } = assemblePrompt({ system: 'S', diff: 'DIFF', skills });
    expect(assembly.skills).toBe(`## Skills\n${skills.join('\n\n')}`);
    expect(assembly.system).not.toContain('Check A');
  });

  it('is byte-identical to the no-skills output when skills are empty', () => {
    const a = assemblePrompt({ system: 'S', diff: 'DIFF' });
    const b = assemblePrompt({ system: 'S', diff: 'DIFF', skills: [] });
    expect(b.messages).toEqual(a.messages);
    expect(b.assembly.skills).toBeNull();
    expect(systemOf({ system: 'S', diff: 'DIFF' })).not.toContain('## Skills');
  });
});
