import { describe, it, expect } from 'vitest';
import {
  isSkillContentChange,
  rate,
  renderSkillBlock,
  skillsLogLine,
  toCardStats,
} from '../src/modules/skills/helpers.js';
import { countPromptTokens } from '../src/platform/trace-builder.js';

describe('skills stats math', () => {
  it('rate is null when there is nothing to divide by', () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(3, 0)).toBeNull();
    expect(rate(1, 4)).toBe(0.25);
    expect(rate(5, 4)).toBe(1); // clamped
  });

  it('toCardStats: no data → zero agents, null rates; decided = accepted + dismissed', () => {
    expect(toCardStats(undefined)).toEqual({ agent_count: 0, pull_rate: null, accept_rate: null });
    expect(
      toCardStats({ agentCount: 2, runsTotal: 0, runsWithSkill: 0, accepted: 0, dismissed: 0 }),
    ).toEqual({ agent_count: 2, pull_rate: null, accept_rate: null });
    expect(
      toCardStats({ agentCount: 1, runsTotal: 4, runsWithSkill: 3, accepted: 1, dismissed: 3 }),
    ).toEqual({ agent_count: 1, pull_rate: 0.75, accept_rate: 0.25 });
  });
});

describe('skills helpers', () => {
  it('renders the one prompt block format', () => {
    expect(renderSkillBlock('no-then-chains', 'Use await.')).toBe('### Skill: no-then-chains\nUse await.');
  });

  it('log line lists name and version, or says none', () => {
    expect(skillsLogLine([])).toBe('Skills: none');
    expect(
      skillsLogLine([
        { name: 'secret-leakage-gate', version: 1 },
        { name: 'lethal-trifecta', version: 3 },
      ]),
    ).toBe('Skills: 2 loaded (secret-leakage-gate v1, lethal-trifecta v3)');
  });

  it('only a change to name/description/type/body is a content change', () => {
    const base = { name: 'a', description: 'b', type: 'custom' as const, body: 'c' };
    expect(isSkillContentChange(base, {})).toBe(false);
    expect(isSkillContentChange(base, { name: 'a', body: 'c' })).toBe(false);
    expect(isSkillContentChange(base, { body: 'd' })).toBe(true);
    expect(isSkillContentChange(base, { type: 'security' })).toBe(true);
  });

  it('countPromptTokens counts only non-empty slots', () => {
    const counts = countPromptTokens(
      { system: 'abcd', skills: '## Skills\nx', memory: null, specs: '', user: 'u' },
      (s) => s.length,
    );
    expect(counts).toEqual({ system: 4, skills: 11, user: 1 });
  });

  /**
   * Spec 0008. The slot has to be in PROMPT_TOKEN_SLOTS or its tokens are
   * invisible in the trace while still being paid for in the request — the
   * failure mode is silent, so it gets its own test.
   */
  it('countPromptTokens counts the intent slot, and skips it when absent', () => {
    const withIntent = countPromptTokens(
      { system: 'abcd', pr_description: 'body', intent: 'Category: feature', user: 'u' },
      (s) => s.length,
    );
    expect(withIntent.intent).toBe('Category: feature'.length);

    const withoutIntent = countPromptTokens(
      { system: 'abcd', pr_description: 'body', intent: null, user: 'u' },
      (s) => s.length,
    );
    expect(withoutIntent).not.toHaveProperty('intent');
  });
});
