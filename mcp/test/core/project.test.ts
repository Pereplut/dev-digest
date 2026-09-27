import { describe, expect, it } from 'vitest';
import {
  MAX_FINDING_TEXT_CHARS,
  closestSlug,
  currentWave,
  decodeCursor,
  encodeCursor,
  enabledAgentNames,
  filterFindings,
  paginate,
  projectAgent,
  projectConvention,
  projectFinding,
  resolveRepoSlug,
  truncateText,
} from '../../src/core/project.js';
import type { AgentSummary, ConventionItem, FindingItem, RepoSummary, RunListItem } from '../../src/ports.js';

const agent: AgentSummary = {
  id: 'a1',
  name: 'Strict Reviewer',
  model: 'claude-sonnet-5',
  provider: 'anthropic',
  enabled: true,
  description: 'Blocks on critical findings.',
  strategy: 'single-pass',
  ciFailOn: 'critical',
  skillCount: 3,
};

const finding: FindingItem = {
  id: 'f1',
  file: 'src/x.ts',
  startLine: 10,
  endLine: 12,
  severity: 'CRITICAL',
  category: 'security',
  title: 'sql injection',
  rationale: 'a'.repeat(50),
  suggestion: 'use a parameterised query',
};

const convention: ConventionItem = {
  category: 'naming',
  rule: 'files are kebab-case',
  evidencePath: 'src/foo-bar.ts',
  evidenceStartLine: 1,
  evidenceEndLine: 1,
  evidenceSnippet: 'export const fooBar = 1;',
  status: 'accepted',
};

describe('core/project — ring 1 (no network, no SDK)', () => {
  it('projects an agent concisely by default', () => {
    const projected = projectAgent(agent, 'concise');
    expect(projected).toEqual({ id: 'a1', name: 'Strict Reviewer', model: 'claude-sonnet-5', enabled: true });
    expect(projected).not.toHaveProperty('description');
  });

  it('detailed agent projection adds description, strategy, ci_fail_on, skill_count', () => {
    const projected = projectAgent(agent, 'detailed');
    expect(projected).toEqual({
      id: 'a1',
      name: 'Strict Reviewer',
      model: 'claude-sonnet-5',
      enabled: true,
      description: 'Blocks on critical findings.',
      strategy: 'single-pass',
      ci_fail_on: 'critical',
      skill_count: 3,
    });
  });

  it('projects a finding concisely: file, line, severity, title only', () => {
    const projected = projectFinding(finding, 'concise');
    expect(projected).toEqual({ file: 'src/x.ts', line: 10, severity: 'CRITICAL', title: 'sql injection' });
    expect(projected).not.toHaveProperty('rationale');
    expect(projected).not.toHaveProperty('suggestion');
  });

  it('detailed finding projection adds rationale and suggestion', () => {
    const projected = projectFinding(finding, 'detailed');
    expect(projected).toMatchObject({ rationale: finding.rationale, suggestion: finding.suggestion });
  });

  it('projects a convention concisely: category, rule, evidence path only', () => {
    const projected = projectConvention(convention, 'concise');
    expect(projected).toEqual({ category: 'naming', rule: 'files are kebab-case', evidence_path: 'src/foo-bar.ts' });
  });

  it('detailed convention projection adds the evidence snippet', () => {
    const projected = projectConvention(convention, 'detailed');
    expect(projected).toMatchObject({ evidence_snippet: convention.evidenceSnippet });
  });

  it('truncates text over the cap and says so', () => {
    const long = 'x'.repeat(MAX_FINDING_TEXT_CHARS + 500);
    const truncated = truncateText(long);
    expect(truncated.length).toBeLessThan(long.length);
    expect(truncated).toContain('truncated');
  });

  it('leaves short text untouched', () => {
    expect(truncateText('short')).toBe('short');
  });

  it('filters findings by severity', () => {
    const other: FindingItem = { ...finding, id: 'f2', severity: 'SUGGESTION' };
    const filtered = filterFindings([finding, other], { severity: ['CRITICAL'] });
    expect(filtered).toEqual([finding]);
  });

  it('filters findings by category', () => {
    const other: FindingItem = { ...finding, id: 'f2', category: 'style' };
    const filtered = filterFindings([finding, other], { category: ['style'] });
    expect(filtered).toEqual([other]);
  });

  it('with no filter, returns everything unchanged', () => {
    expect(filterFindings([finding], {})).toEqual([finding]);
  });

  it('resolves an exact (case-insensitive) repo slug', () => {
    const repos: RepoSummary[] = [{ id: 'r1', owner: 'acme', name: 'web', fullName: 'acme/web' }];
    expect(resolveRepoSlug(repos, 'ACME/WEB')).toEqual({ ok: true, repo: repos[0] });
  });

  it('reports the closest slug when nothing matches', () => {
    const repos: RepoSummary[] = [{ id: 'r1', owner: 'acme', name: 'web', fullName: 'acme/web' }];
    const result = resolveRepoSlug(repos, 'acme/wb');
    expect(result).toEqual({ ok: false, closest: 'acme/web' });
  });

  it('closestSlug is null with no repos to suggest', () => {
    expect(closestSlug([], 'acme/web')).toBeNull();
  });

  it('lists only enabled agent names', () => {
    const disabled: AgentSummary = { ...agent, id: 'a2', name: 'Disabled One', enabled: false };
    expect(enabledAgentNames([agent, disabled])).toEqual(['Strict Reviewer']);
  });

  it('paginate slices by an opaque cursor and reports the next one', () => {
    const items = Array.from({ length: 5 }, (_, i) => i);
    const first = paginate(items, { limit: 2 });
    if (!first.ok) throw new Error('expected a page');
    expect(first.page.items).toEqual([0, 1]);
    expect(first.page.nextCursor).not.toBeNull();

    const second = paginate(items, { limit: 2, cursor: first.page.nextCursor! });
    if (!second.ok) throw new Error('expected a page');
    expect(second.page.items).toEqual([2, 3]);

    const third = paginate(items, { limit: 2, cursor: second.page.nextCursor! });
    if (!third.ok) throw new Error('expected a page');
    expect(third.page.items).toEqual([4]);
    expect(third.page.nextCursor).toBeNull();
  });

  it('cursor round-trips through encode/decode', () => {
    expect(decodeCursor(encodeCursor(7))).toEqual({ ok: true, offset: 7 });
  });

  /**
   * This used to assert the opposite — that a garbage cursor "tolerantly"
   * decoded to offset 0. That is the defect: offset 0 is indistinguishable from
   * no cursor, so a bad cursor silently re-served page one as the next page,
   * while the route this wraps answers the same input with a 400. The test
   * encoded the bug, so it had to change with the fix.
   */
  it('decodeCursor reports failure instead of collapsing a bad cursor to offset 0', () => {
    expect(decodeCursor('not-a-real-cursor')).toEqual({ ok: false });
    expect(decodeCursor(Buffer.from('{"offset":-1}', 'utf8').toString('base64url'))).toEqual({ ok: false });
    expect(decodeCursor(Buffer.from('{"offset":1.5}', 'utf8').toString('base64url'))).toEqual({ ok: false });
    expect(decodeCursor(Buffer.from('{}', 'utf8').toString('base64url'))).toEqual({ ok: false });
    // The server's own cursor format — base64 of "<rank>|<uuid>" — is the
    // realistic wrong value: a caller moving next_cursor between the two modes.
    expect(
      decodeCursor(Buffer.from('0|970fd9e4-8fb9-422a-a513-d483', 'utf8').toString('base64url')),
    ).toEqual({ ok: false });
    // No cursor is not a failure.
    expect(decodeCursor(undefined)).toEqual({ ok: true, offset: 0 });
  });

  it('paginate refuses a bad cursor rather than returning page one', () => {
    const items = Array.from({ length: 5 }, (_, i) => i);
    expect(paginate(items, { limit: 2, cursor: 'not-a-real-cursor' })).toEqual({ ok: false });
  });
});

/**
 * Regression from live testing on Pereplut/dev-digest#6: four runs were started,
 * but the still-executing message read "0 of 5 agents done". The fifth was a
 * `failed` run from nine days earlier whose agent had since been deleted — with
 * `agentId: null` it keyed on its own run id and survived a "latest run per
 * agent" tally as its own pseudo-agent. The total could never be reached, so the
 * message would read as permanently stuck.
 */
describe('currentWave — only the runs of the review now in flight', () => {
  const run = (o: Partial<RunListItem> & { runId: string }): RunListItem => ({
    agentId: o.agentId ?? `agent-${o.runId}`,
    status: o.status ?? 'done',
    ranAt: o.ranAt ?? null,
    runId: o.runId,
  });

  it('excludes a historical failed run from a deleted agent', () => {
    const wave = currentWave([
      run({ runId: 'r4', status: 'running', ranAt: '2026-09-27T17:05:59.732Z' }),
      run({ runId: 'r3', status: 'running', ranAt: '2026-09-27T17:05:59.730Z' }),
      run({ runId: 'r2', status: 'running', ranAt: '2026-09-27T17:05:59.727Z' }),
      run({ runId: 'r1', status: 'running', ranAt: '2026-09-27T17:05:59.723Z' }),
      run({ runId: 'ghost', agentId: null, status: 'failed', ranAt: '2026-09-20T17:55:13.196Z' }),
      run({ runId: 'old2', status: 'done', ranAt: '2026-09-17T09:03:10.572Z' }),
      run({ runId: 'old1', status: 'done', ranAt: '2026-09-17T08:59:27.376Z' }),
    ]);
    expect(wave.map((r) => r.runId).sort()).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('counts a run that finished within the wave', () => {
    const wave = currentWave([
      run({ runId: 'b', status: 'done', ranAt: '2026-09-27T17:00:05.000Z' }),
      run({ runId: 'a', status: 'running', ranAt: '2026-09-27T17:00:00.000Z' }),
      run({ runId: 'old', status: 'done', ranAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(wave.map((r) => r.runId).sort()).toEqual(['a', 'b']);
    expect(wave.filter((r) => r.status === 'done')).toHaveLength(1);
  });

  /**
   * The second bug, caught live on the same PR: anchoring on the oldest RUNNING
   * run dropped the wave's earliest agent as soon as it finished, so "1 of 4"
   * rendered as "0 of 3" — the denominator shrank while work completed.
   */
  it('keeps the wave stable as its earliest agent finishes', () => {
    const batch = [
      run({ runId: 'r4', status: 'running', ranAt: '2026-09-27T17:05:59.732Z' }),
      run({ runId: 'r3', status: 'running', ranAt: '2026-09-27T17:05:59.730Z' }),
      run({ runId: 'r2', status: 'running', ranAt: '2026-09-27T17:05:59.727Z' }),
      run({ runId: 'r1', status: 'done', ranAt: '2026-09-27T17:05:59.723Z' }),
      run({ runId: 'ghost', agentId: null, status: 'failed', ranAt: '2026-09-20T17:55:13.196Z' }),
    ];
    const wave = currentWave(batch);
    expect(wave).toHaveLength(4);
    expect(wave.map((r) => r.runId)).not.toContain('ghost');
    expect(wave.filter((r) => r.status === 'done')).toHaveLength(1);
  });

  it('does not merge two reviews minutes apart into one wave', () => {
    const wave = currentWave([
      run({ runId: 'new', status: 'running', ranAt: '2026-09-27T17:10:00.000Z' }),
      run({ runId: 'prev', status: 'done', ranAt: '2026-09-27T17:00:00.000Z' }),
    ]);
    expect(wave.map((r) => r.runId)).toEqual(['new']);
  });

  it('ignores a finished cluster newer than nothing running', () => {
    // Newest cluster is fully done; the only running run is older and unstamped.
    const wave = currentWave([
      run({ runId: 'done2', status: 'done', ranAt: '2026-09-27T17:10:00.000Z' }),
      run({ runId: 'done1', status: 'done', ranAt: '2026-09-27T17:09:59.000Z' }),
      run({ runId: 'ghostrun', status: 'running', ranAt: null }),
    ]);
    expect(wave.map((r) => r.runId)).toEqual(['ghostrun']);
  });

  it('is empty when nothing is running, so the caller reads results instead', () => {
    expect(currentWave([run({ runId: 'a', ranAt: '2026-09-27T17:00:00.000Z' })])).toEqual([]);
  });

  it('keeps a running run that has no timestamp — history has finished by definition', () => {
    const wave = currentWave([
      run({ runId: 'nostamp', status: 'running', ranAt: null }),
      run({ runId: 'old', status: 'done', ranAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(wave.map((r) => r.runId)).toEqual(['nostamp']);
  });
});
