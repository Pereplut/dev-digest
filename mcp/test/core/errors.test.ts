import { describe, expect, it } from 'vitest';
import {
  agentDisabledText,
  apiErrorText,
  apiUnreachableText,
  blastPullRequestUnknownText,
  bothRunIdAndRepoText,
  repositoryUnknownText,
  runStillExecutingText,
} from '../../src/core/errors.js';
import type { AgentSummary } from '../../src/ports.js';

/**
 * One test per error text from spec 0011's "Error texts — use verbatim"
 * table, each asserting the message NAMES THE NEXT ACTION, not just the
 * failure (spec 0011 test plan).
 *
 * `runStillExecutingText` has two variants (deviation from the spec's single
 * verbatim text, confirmed with the server agent building `GET
 * /runs/:id/findings`): the `run_id` path knows only that one run's status —
 * no pull id, no sibling runs — so "N of M agents done" is derivable only in
 * the `repo`+`pull_number` path, which counts via `GET /pulls/:id/runs`.
 */
describe('core/errors — the six tool-error texts', () => {
  it('run still executing (repo+pull_number mode): the verbatim spec 0011 text', () => {
    const text = runStillExecutingText({ mode: 'pull', runId: 'run-42', status: 'running', agentsTotal: 3, agentsDone: 2 });
    expect(text).toBe(
      'Run run-42 is still executing (status: running, 2 of 3 agents done). Call get_findings ' +
        'again with the same run_id in a few seconds. Do not call review_pull_request again.',
    );
    expect(text).toContain('Call get_findings again');
    expect(text).toContain('Do not call review_pull_request again');
  });

  it('run still executing (run_id mode): omits the undeliverable progress clause', () => {
    const text = runStillExecutingText({ mode: 'run', runId: 'run-42', status: 'running' });
    expect(text).toBe(
      'Run run-42 is still executing (status: running). Call get_findings again with the same ' +
        'run_id in a few seconds. Do not call review_pull_request again.',
    );
    expect(text).not.toContain('agents done');
    expect(text).toContain('Call get_findings again');
    expect(text).toContain('Do not call review_pull_request again');
  });

  it('agent disabled: names the next action (omit agent, lists which are enabled)', () => {
    const agents: AgentSummary[] = [
      {
        id: 'a1',
        name: 'Style Nit',
        model: 'gpt-5',
        provider: 'openai',
        enabled: false,
        description: '',
        strategy: 'single-pass',
        ciFailOn: 'never',
        skillCount: null,
      },
      {
        id: 'a2',
        name: 'Strict Reviewer',
        model: 'claude-sonnet-5',
        provider: 'anthropic',
        enabled: true,
        description: '',
        strategy: 'single-pass',
        ciFailOn: 'critical',
        skillCount: null,
      },
    ];
    const text = agentDisabledText('Style Nit', agents);
    expect(text).toBe(
      'Agent "Style Nit" is disabled and cannot be run. Enabled agents: Strict Reviewer. Omit ' +
        'the agent parameter to run all enabled agents.',
    );
    expect(text).toContain('Omit the agent parameter');
  });

  it('repository unknown: names the next action (list_review_agents or add the repo)', () => {
    const text = repositoryUnknownText('acme/wb', 'acme/web');
    expect(text).toBe(
      'No repository "acme/wb" in this workspace. Did you mean "acme/web"? Call list_review_agents ' +
        'to see the workspace, or add the repository in the DevDigest UI.',
    );
    expect(text).toContain('Call list_review_agents');
    expect(text).toContain('add the repository in the DevDigest UI');
  });

  it('repository unknown with no repos to suggest: drops the question, keeps the action', () => {
    const text = repositoryUnknownText('acme/web', null);
    expect(text).toBe(
      'No repository "acme/web" in this workspace. Call list_review_agents to see the workspace, ' +
        'or add the repository in the DevDigest UI.',
    );
    expect(text).not.toContain('Did you mean');
  });

  it('both run_id and repo: names the next action (pick one, explains what each reads)', () => {
    const text = bothRunIdAndRepoText();
    expect(text).toBe(
      "Pass either run_id or repo+pull_number, not both. run_id reads one agent's result; " +
        'repo+pull_number reads the latest from every agent.',
    );
  });

  it('API unreachable: names the next action (start it with the dev script)', () => {
    const text = apiUnreachableText('http://localhost:3001');
    expect(text).toBe(
      'Cannot reach the DevDigest API at http://localhost:3001. Start it with ./scripts/dev.sh ' +
        'from the repository root.',
    );
    expect(text).toContain('./scripts/dev.sh');
  });

  it('blast pull request unknown: verbatim spec 0012 §6 text, naming the recovery', () => {
    const text = blastPullRequestUnknownText(4242, 'acme/web');
    expect(text).toBe(
      'No pull request #4242 in acme/web. DevDigest only knows pull requests it has synced from ' +
        'GitHub — open that repository in the DevDigest UI and refresh its pull request list, then ' +
        'call get_blast_radius again. If the number came from a link or a branch name, check it ' +
        'against GitHub first: this is the PR number, not an internal id.',
    );
    expect(text).toContain('call get_blast_radius again');
    expect(text).toContain('this is the PR number, not an internal id');
  });

  it('apiErrorText keeps the API message, so nothing is swallowed', () => {
    const text = apiErrorText(404, { error: { code: 'not_found', message: 'Agent not found' } });
    expect(text).toContain('Agent not found');
  });
});

/**
 * Regression: `apiErrorText` used to return the API's message verbatim, so a 404
 * surfaced as a bare "Run not found" — a failure with no next action, which is
 * exactly what spec 0011's "errors are context, not dead ends" rules out. Found
 * by calling get_findings with an unknown run id against the live API.
 */
describe('apiErrorText — every status class names a recovery', () => {
  it('a 404 keeps the API message and says where ids come from', () => {
    const text = apiErrorText(404, { error: { code: 'not_found', message: 'Run not found' } });
    expect(text).toContain('Run not found.');
    expect(text).toContain('run ids come from review_pull_request');
    expect(text).toContain('repo and pull_number');
  });

  it('a 429 names the rate limit it is', () => {
    const text = apiErrorText(429, { error: { code: 'rate_limited', message: 'Too many requests' } });
    expect(text).toContain('10-calls-per-minute');
  });

  it('a 5xx says it is a server fault and that retrying is reasonable', () => {
    const text = apiErrorText(503, { error: { code: 'upstream', message: 'Upstream failed' } });
    expect(text).toContain('DevDigest API fault');
    expect(text).toContain('Retrying');
  });

  it('an unrecognised status adds no invented advice', () => {
    const text = apiErrorText(418, { error: { code: 'teapot', message: 'Teapot' } });
    expect(text).toBe('Teapot.');
  });

  it('does not double the full stop when the API message already ends in one', () => {
    const text = apiErrorText(418, { error: { code: 'teapot', message: 'Teapot.' } });
    expect(text).toBe('Teapot.');
  });
});
