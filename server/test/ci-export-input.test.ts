import { describe, it, expect } from 'vitest';
import { CiExportInput } from '@devdigest/shared';

/**
 * CiExportInput contract (spec 0022). No route-level harness for the CI routes
 * exists in server/test, so the 422 the route returns for a failing body is
 * asserted at the schema it is built from (safeParse failure).
 */

const base = { repo: 'acme/widgets' };

describe('CiExportInput', () => {
  it('applies the documented defaults to a minimal body', () => {
    const parsed = CiExportInput.parse(base);
    expect(parsed).toMatchObject({
      target: 'gha',
      action: 'open_pr',
      post_as: 'github_review',
      triggers: ['opened', 'synchronize'],
      base: 'main',
    });
    expect(parsed.workflow_override).toBeUndefined();
  });

  it('triggers: an empty list is accepted as-is (the service applies its defaults later); all three are accepted', () => {
    const empty = CiExportInput.safeParse({ ...base, triggers: [] });
    expect(empty.success).toBe(true);
    expect(empty.success && empty.data.triggers).toEqual([]);
    expect(CiExportInput.safeParse({ ...base, triggers: ['opened', 'synchronize', 'reopened'] }).success).toBe(true);
  });

  it('triggers: a non-pull_request trigger is rejected, as is a list longer than the three allowed', () => {
    const outsider = CiExportInput.safeParse({ ...base, triggers: ['issue_comment'] });
    expect(outsider.success).toBe(false);
    expect(!outsider.success && outsider.error.issues[0]?.path).toEqual(['triggers', 0]);

    const tooMany = CiExportInput.safeParse({ ...base, triggers: ['opened', 'synchronize', 'reopened', 'opened'] });
    expect(tooMany.success).toBe(false);
    expect(!tooMany.success && tooMany.error.issues[0]?.path).toEqual(['triggers']);
  });

  it('workflow_override: blank text and anything over 64,000 characters are rejected; ordinary and boundary-size text is accepted', () => {
    for (const blank of ['', '   ', '\n\t ']) {
      const r = CiExportInput.safeParse({ ...base, workflow_override: blank });
      expect(r.success).toBe(false);
      expect(!r.success && r.error.issues[0]?.path).toEqual(['workflow_override']);
    }

    const tooLong = CiExportInput.safeParse({ ...base, workflow_override: 'a'.repeat(64_001) });
    expect(tooLong.success).toBe(false);
    expect(!tooLong.success && tooLong.error.issues[0]?.path).toEqual(['workflow_override']);

    const yaml = 'name: DevDigest Review\non: pull_request\n';
    const ok = CiExportInput.safeParse({ ...base, workflow_override: yaml });
    expect(ok.success && ok.data.workflow_override).toBe(yaml); // byte-for-byte, not trimmed
    expect(CiExportInput.safeParse({ ...base, workflow_override: 'a'.repeat(64_000) }).success).toBe(true);
  });

  it('repo must be non-empty', () => {
    expect(CiExportInput.safeParse({ repo: '' }).success).toBe(false);
    expect(CiExportInput.safeParse({}).success).toBe(false);
  });
});
