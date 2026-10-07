/**
 * `buildBriefMessages` + `BriefResponse` (spec 0018, S5/S13). AC-6 wraps
 * exactly the PR title, PR body, each spec path and the issue reference;
 * nothing else — the blast summary is a control that stays unwrapped. AC-7
 * and AC-50 cover the schema + the stated caps.
 */
import { describe, it, expect } from 'vitest';
import { buildBriefMessages, BriefResponse, BRIEF_SYSTEM_MESSAGE } from '../src/modules/brief/prompt.js';
import { BRIEF_MAX_FOCUS, BRIEF_MAX_RISKS } from '../src/modules/brief/constants.js';

const BASE = {
  title: 'Add rate limiting',
  intentText: null as string | null,
  body: '',
  issueRef: null as string | null,
  specPaths: [] as string[],
  blastSummary: '1 symbol · 2 callers · 0 endpoints · 0 crons',
  blastCallerLines: [] as string[],
  smartDiffLines: [] as string[],
  fileStats: [] as { path: string; additions: number; deletions: number }[],
};

function allContent(messages: ReturnType<typeof buildBriefMessages>): string {
  return messages.map((m) => m.content).join('\n');
}

describe('buildBriefMessages — AC-6 wrapping', () => {
  it('wraps the PR title', () => {
    const messages = buildBriefMessages({ ...BASE, title: 'DISTINCTIVE_TITLE_1' });
    const content = allContent(messages);
    expect(content).toContain('DISTINCTIVE_TITLE_1');
    expect(content).toMatch(/<untrusted source="pr-title">\n[\s\S]*DISTINCTIVE_TITLE_1[\s\S]*<\/untrusted>/);
  });

  it('wraps the PR body', () => {
    const messages = buildBriefMessages({ ...BASE, body: 'DISTINCTIVE_BODY_1' });
    const content = allContent(messages);
    expect(content).toMatch(/<untrusted source="pr-body">\n[\s\S]*DISTINCTIVE_BODY_1[\s\S]*<\/untrusted>/);
  });

  it('wraps the linked issue reference', () => {
    const messages = buildBriefMessages({ ...BASE, issueRef: '#4821' });
    const content = allContent(messages);
    expect(content).toMatch(/<untrusted source="issue-ref">\n#4821\n<\/untrusted>/);
  });

  it('wraps each spec path individually', () => {
    const messages = buildBriefMessages({
      ...BASE,
      specPaths: ['specs/0001-a.md', 'specs/0002-b.md'],
    });
    const content = allContent(messages);
    expect(content).toMatch(/<untrusted source="spec-0">\nspecs\/0001-a\.md\n<\/untrusted>/);
    expect(content).toMatch(/<untrusted source="spec-1">\nspecs\/0002-b\.md\n<\/untrusted>/);
  });

  it('wraps the derived intent', () => {
    // Server-derived but not server-authored: it is a model's summary of the
    // author's title, body and specs. `reviewer-core/src/prompt.ts` wraps the
    // same value under the same source name.
    const messages = buildBriefMessages({ ...BASE, intentText: 'DISTINCTIVE_INTENT_1' });
    const content = allContent(messages);
    expect(content).toMatch(
      /<untrusted source="derived-intent">\n[\s\S]*DISTINCTIVE_INTENT_1[\s\S]*<\/untrusted>/,
    );
  });

  it('wraps the three blocks built from author-chosen file paths', () => {
    // git permits instruction-like file names, and grounding only checks the
    // model's path FIELDS against this PR — never its prose — so a hijacked
    // summary or explanation would not be caught downstream.
    const messages = buildBriefMessages({
      ...BASE,
      blastCallerLines: ['src/DISTINCTIVE_CALLER.ts:12 handler'],
      smartDiffLines: ['core: src/DISTINCTIVE_ROLE.ts (+3/-1)'],
      fileStats: [{ path: 'src/DISTINCTIVE_STAT.ts', additions: 3, deletions: 1 }],
    });
    const content = allContent(messages);
    expect(content).toMatch(
      /<untrusted source="blast-callers">\n[\s\S]*DISTINCTIVE_CALLER[\s\S]*<\/untrusted>/,
    );
    expect(content).toMatch(
      /<untrusted source="smart-diff">\n[\s\S]*DISTINCTIVE_ROLE[\s\S]*<\/untrusted>/,
    );
    expect(content).toMatch(
      /<untrusted source="diff-stats">\n[\s\S]*DISTINCTIVE_STAT[\s\S]*<\/untrusted>/,
    );
  });

  it('control: the blast summary is NOT wrapped', () => {
    const messages = buildBriefMessages({ ...BASE, blastSummary: 'DISTINCTIVE_BLAST_SUMMARY' });
    const content = allContent(messages);
    expect(content).toContain('DISTINCTIVE_BLAST_SUMMARY');
    expect(content).not.toMatch(/<untrusted[^>]*>\s*DISTINCTIVE_BLAST_SUMMARY/);
  });

  it('control: no spec content and no issue body ever appear — only the path/reference', () => {
    const messages = buildBriefMessages({
      ...BASE,
      issueRef: '#99',
      specPaths: ['specs/0003-c.md'],
    });
    const content = allContent(messages);
    // Only what the two obligations actually carry — a path and a reference —
    // is present; there is no field anywhere in BriefPromptFacts for a spec's
    // text or an issue's body, so this just documents the absence is total.
    expect(content).toContain('#99');
    expect(content).toContain('specs/0003-c.md');
  });

  it('omits sections entirely when their facts are absent', () => {
    const messages = buildBriefMessages(BASE);
    const content = allContent(messages);
    expect(content).not.toContain('## PR description');
    expect(content).not.toContain('## Linked issue');
    expect(content).not.toContain('## Specifications referenced');
    expect(content).not.toContain('## Blast radius callers');
    expect(content).not.toContain('## Changed files by role');
    expect(content).not.toContain('## Diff statistics');
    expect(content).not.toContain('## Stated intent');
  });

  it('includes the stated intent when present', () => {
    const messages = buildBriefMessages({ ...BASE, intentText: 'Adds a readiness probe.' });
    expect(allContent(messages)).toContain('Adds a readiness probe.');
  });
});

describe('BRIEF_SYSTEM_MESSAGE — AC-50', () => {
  it('states both caps', () => {
    expect(BRIEF_SYSTEM_MESSAGE).toContain(String(BRIEF_MAX_RISKS));
    expect(BRIEF_SYSTEM_MESSAGE).toContain(String(BRIEF_MAX_FOCUS));
  });
});

describe('BriefResponse schema — AC-7, AC-50', () => {
  const complete = {
    summary: 'A summary.',
    risks: [
      {
        kind: 'security',
        title: 't',
        explanation: 'e',
        severity: 'medium' as const,
        file_refs: ['src/a.ts'],
      },
    ],
    review_focus: [{ file: 'src/a.ts', line: 1, reason: 'r' }],
  };

  it('accepts a complete response', () => {
    expect(BriefResponse.safeParse(complete).success).toBe(true);
  });

  it('rejects a response missing summary', () => {
    const { summary: _summary, ...rest } = complete;
    expect(BriefResponse.safeParse(rest).success).toBe(false);
  });

  it('rejects a response missing review_focus', () => {
    const { review_focus: _review_focus, ...rest } = complete;
    expect(BriefResponse.safeParse(rest).success).toBe(false);
  });

  it('control: 7 risks still validate — the cap is a prompt instruction, not a schema rule', () => {
    const sevenRisks = {
      ...complete,
      risks: Array.from({ length: 7 }, (_, i) => ({ ...complete.risks[0]!, title: `risk ${i}` })),
    };
    expect(BriefResponse.safeParse(sevenRisks).success).toBe(true);
  });
});
