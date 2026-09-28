import { describe, expect, it } from 'vitest';
import { MOCK_RUN_ID, MockDevDigestApi } from '../../src/adapters/mocks.js';
import { getFindings } from '../../src/tools/findings.js';

describe('tools/findings — ring 3, MockDevDigestApi, no network', () => {
  it('reads findings for a completed run', async () => {
    const api = new MockDevDigestApi();
    const result = await getFindings(api, { by: 'run', runId: MOCK_RUN_ID, limit: 20 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('unreachable');
    expect(result.findings).toHaveLength(2);
    expect(result.status).toBe('done');
  });

  it('reports still-running for a run in progress, by run_id (no batch progress — not derivable)', async () => {
    const api = new MockDevDigestApi();
    const started = await api.startReview('pull-1', { all: true });
    const runId = started[0]!.runId;
    const result = await getFindings(api, { by: 'run', runId, limit: 20 });
    expect(result.kind).toBe('still-running');
    if (result.kind !== 'still-running') throw new Error('unreachable');
    expect(result.info).toEqual({ mode: 'run', runId, status: 'running' });
  });

  it('reports still-running by repo+pull_number, with the batch progress', async () => {
    const api = new MockDevDigestApi();
    const started = await api.startReview('pull-1', { all: true });
    const runId = started[0]!.runId;
    const result = await getFindings(api, { by: 'pull', repo: 'acme/web', pullNumber: 42, limit: 20 });
    expect(result.kind).toBe('still-running');
    if (result.kind !== 'still-running') throw new Error('unreachable');
    expect(result.info).toEqual({ mode: 'pull', runId, status: 'running', agentsTotal: 1, agentsDone: 0 });
  });

  it('filters by severity on the run path', async () => {
    const api = new MockDevDigestApi();
    const result = await getFindings(api, { by: 'run', runId: MOCK_RUN_ID, severity: ['CRITICAL'], limit: 20 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('unreachable');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('CRITICAL');
  });

  it('reads the latest findings from every agent by repo+pull_number', async () => {
    const api = new MockDevDigestApi();
    const result = await getFindings(api, { by: 'pull', repo: 'acme/web', pullNumber: 42, limit: 20 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('unreachable');
    expect(result.findings).toHaveLength(2);
    expect(result.status).toBeNull();
  });

  it('paginates the repo+pull_number path in memory', async () => {
    const api = new MockDevDigestApi();
    const first = await getFindings(api, { by: 'pull', repo: 'acme/web', pullNumber: 42, limit: 1 });
    if (first.kind !== 'ok') throw new Error('unreachable');
    expect(first.findings).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();

    const second = await getFindings(api, {
      by: 'pull',
      repo: 'acme/web',
      pullNumber: 42,
      limit: 1,
      cursor: first.nextCursor!,
    });
    if (second.kind !== 'ok') throw new Error('unreachable');
    expect(second.findings).toHaveLength(1);
    expect(second.findings[0]?.id).not.toBe(first.findings[0]?.id);
  });

  it('errors when the repo slug is unknown', async () => {
    const api = new MockDevDigestApi();
    const result = await getFindings(api, { by: 'pull', repo: 'nope/nothing', pullNumber: 1, limit: 20 });
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('unreachable');
    expect(result.text).toContain('No repository "nope/nothing"');
  });
});
