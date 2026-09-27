import { describe, expect, it } from 'vitest';
import { MockDevDigestApi } from '../../src/adapters/mocks.js';
import { runReview } from '../../src/tools/run-review.js';

describe('tools/run-review — ring 3, MockDevDigestApi, no network', () => {
  it('starts every enabled agent when no agent id is given', async () => {
    const api = new MockDevDigestApi();
    const result = await runReview(api, { repo: 'acme/web', pullNumber: 42 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('unreachable');
    expect(result.runs).toHaveLength(1); // only agent-1 is enabled in the fixture
    expect(result.runs[0]?.agentId).toBe('agent-1');
  });

  it('starts exactly the named enabled agent', async () => {
    const api = new MockDevDigestApi();
    const result = await runReview(api, { repo: 'acme/web', pullNumber: 42, agentId: 'agent-1' });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('unreachable');
    expect(result.runs).toEqual([{ runId: expect.stringContaining('run-'), agentId: 'agent-1', agentName: 'Strict Reviewer' }]);
  });

  it('errors when the repo slug is unknown', async () => {
    const api = new MockDevDigestApi();
    const result = await runReview(api, { repo: 'nope/nothing', pullNumber: 1 });
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('unreachable');
    expect(result.text).toContain('No repository "nope/nothing"');
  });

  it('errors when the pull number does not exist on that repo', async () => {
    const api = new MockDevDigestApi();
    const result = await runReview(api, { repo: 'acme/web', pullNumber: 9999 });
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('unreachable');
    expect(result.text).toContain('No pull request #9999');
  });

  it('errors when the named agent id does not exist', async () => {
    const api = new MockDevDigestApi();
    const result = await runReview(api, { repo: 'acme/web', pullNumber: 42, agentId: 'no-such-agent' });
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('unreachable');
    expect(result.text).toContain('No agent "no-such-agent"');
  });

  it('errors with the verbatim text when the named agent is disabled', async () => {
    const api = new MockDevDigestApi();
    const result = await runReview(api, { repo: 'acme/web', pullNumber: 42, agentId: 'agent-2' });
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('unreachable');
    expect(result.text).toBe(
      'Agent "Style Nit" is disabled and cannot be run. Enabled agents: Strict Reviewer. Omit ' +
        'the agent parameter to run all enabled agents.',
    );
  });
});
