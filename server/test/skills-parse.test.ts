import { describe, it, expect } from 'vitest';
import { parseSkillMarkdown } from '../src/modules/skills/import/parse-skill-md.js';
import { draftFromMarkdown } from '../src/modules/skills/import/preview.js';
import { AppError } from '../src/platform/errors.js';

describe('parseSkillMarkdown', () => {
  it('reads plain, double- and single-quoted scalars and the body', () => {
    const md = [
      '---',
      'name: secret-leakage-gate   # trailing comment',
      'description: "Flag \\"live\\" keys"',
      "type: 'security'",
      '---',
      '',
      '# Heading',
      'Body text.',
    ].join('\n');
    const r = parseSkillMarkdown(md);
    expect(r.hasFrontmatter).toBe(true);
    expect(r.frontmatter).toEqual({
      name: 'secret-leakage-gate',
      description: 'Flag "live" keys',
      type: 'security',
    });
    expect(r.body).toBe('# Heading\nBody text.');
  });

  it('folds a `>-` description and keeps a `|` block literal', () => {
    const md = [
      '---',
      'name: over-mocking',
      'description: >-',
      '  Use when a test mocks',
      '  the unit under test.',
      '',
      '  Second paragraph.',
      'notes: |',
      '  line one',
      '  line two',
      '---',
      'body',
    ].join('\n');
    const { frontmatter } = parseSkillMarkdown(md);
    expect(frontmatter.description).toBe('Use when a test mocks the unit under test.\nSecond paragraph.');
    expect(frontmatter.notes).toBe('line one\nline two\n');
  });

  it('folds an indented plain continuation and handles CRLF + BOM', () => {
    const md = '﻿---\r\nname: x\r\ndescription: first line\r\n  continues here\r\n---\r\nB';
    const r = parseSkillMarkdown(md);
    expect(r.frontmatter.description).toBe('first line continues here');
    expect(r.body).toBe('B');
  });

  it('skips nested mappings, lists and flow collections', () => {
    const md = ['---', 'name: n', 'meta:', '  a: 1', 'tags: [a, b]', 'list:', '  - x', '---', 'b'].join('\n');
    expect(parseSkillMarkdown(md).frontmatter).toEqual({ name: 'n' });
  });

  it('treats a file without (or with an unclosed) frontmatter as all body', () => {
    expect(parseSkillMarkdown('# Just markdown').hasFrontmatter).toBe(false);
    const unclosed = parseSkillMarkdown('---\nname: x\nno end');
    expect(unclosed.hasFrontmatter).toBe(false);
    expect(unclosed.body).toBe('---\nname: x\nno end');
  });
});

describe('draftFromMarkdown', () => {
  it('derives name from the file and description from the first paragraph', () => {
    const d = draftFromMarkdown('# Title\n\nChecks every API route for breaking changes.\n\nMore.', 'API Versioning.md');
    expect(d).toMatchObject({
      name: 'api-versioning',
      description: 'Checks every API route for breaking changes.',
      type: 'custom',
    });
  });

  it('uses the folder name for a SKILL.md and the archive name at the root', () => {
    expect(draftFromMarkdown('Body para.', 'flaky-test-patterns/SKILL.md').name).toBe('flaky-test-patterns');
    expect(draftFromMarkdown('Body para.', 'SKILL.md', 'My Archive').name).toBe('my-archive');
  });

  it('falls back to type custom for an unknown type', () => {
    const d = draftFromMarkdown('---\nname: a\ndescription: b\ntype: weird\n---\nbody', 'a.md');
    expect(d.type).toBe('custom');
  });

  it('truncates a long derived description', () => {
    const d = draftFromMarkdown(`${'word '.repeat(200)}`, 'x.md');
    expect(d.description.length).toBeLessThanOrEqual(280);
    expect(d.description.endsWith('…')).toBe(true);
  });

  it('rejects an empty body with a 422 carrying the issues', () => {
    try {
      draftFromMarkdown('---\nname: a\ndescription: b\n---\n', 'a.md');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(422);
      expect((err as AppError).details).toBeTruthy();
    }
  });
});
