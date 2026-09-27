import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MOCK_RUN_ID, MockDevDigestApi } from '../src/adapters/mocks.js';
import { createDevDigestServer } from '../src/registry.js';

/**
 * End-to-end tool tests over the real MCP wire protocol (`InMemoryTransport`,
 * no stdio/HTTP), driven by `MockDevDigestApi` — every tool is exercisable
 * with no network (spec 0011 acceptance criterion 9 / test plan "Rings 3-4").
 */
async function connect(api = new MockDevDigestApi()) {
  const server = createDevDigestServer(api);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server, api };
}

function textOf(result: { content: { type: string; text?: string }[] }): string {
  const block = result.content.find((c) => c.type === 'text');
  if (!block?.text) throw new Error('expected a text content block');
  return block.text;
}

describe('registry — the five tools end to end (MCP wire protocol, MockDevDigestApi)', () => {
  let client: Client;
  let close: () => Promise<void>;

  beforeEach(async () => {
    const ctx = await connect();
    client = ctx.client;
    close = async () => {
      await client.close();
      await ctx.server.close();
    };
  });

  afterEach(async () => {
    await close();
  });

  it('tools/list returns exactly the five tools, no more, no less', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ['get_blast_radius', 'get_findings', 'get_repo_conventions', 'list_review_agents', 'review_pull_request'].sort(),
    );
  });

  it('every tool sets all four annotation fields explicitly', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toBeDefined();
      expect(tool.annotations?.readOnlyHint, tool.name).toBeTypeOf('boolean');
      expect(tool.annotations?.destructiveHint, tool.name).toBeTypeOf('boolean');
      expect(tool.annotations?.idempotentHint, tool.name).toBeTypeOf('boolean');
      expect(tool.annotations?.openWorldHint, tool.name).toBeTypeOf('boolean');
    }
  });

  it('review_pull_request is the one non-read-only, non-idempotent, open-world tool', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'review_pull_request');
    expect(tool?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it('the other four tools are read-only, non-destructive, idempotent, closed-world', async () => {
    const { tools } = await client.listTools();
    for (const name of ['list_review_agents', 'get_findings', 'get_repo_conventions', 'get_blast_radius']) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.annotations, name).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  it('no tool declares outputSchema', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.outputSchema, tool.name).toBeUndefined();
    }
  });

  it('every input schema is strict (additionalProperties: false)', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    }
  });

  it('list_review_agents: concise by default, includes disabled agents marked as such', async () => {
    const result = await client.callTool({ name: 'list_review_agents', arguments: {} });
    const body = JSON.parse(textOf(result));
    expect(body.agents).toHaveLength(2);
    expect(body.agents.find((a: { id: string }) => a.id === 'agent-2')).toMatchObject({ enabled: false });
    expect(body.agents[0]).not.toHaveProperty('description');
  });

  it('list_review_agents: detailed adds description, strategy, ci_fail_on, skill_count', async () => {
    const result = await client.callTool({
      name: 'list_review_agents',
      arguments: { response_format: 'detailed' },
    });
    const body = JSON.parse(textOf(result));
    expect(body.agents[0]).toMatchObject({
      description: expect.any(String),
      strategy: expect.any(String),
      ci_fail_on: expect.any(String),
    });
  });

  it('review_pull_request: starts every enabled agent and returns a run_id per agent', async () => {
    const result = await client.callTool({
      name: 'review_pull_request',
      arguments: { repo: 'acme/web', pull_number: 42 },
    });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(textOf(result));
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({ agent_id: 'agent-1', agent_name: 'Strict Reviewer' });
  });

  it('review_pull_request: unknown repo is a tool-execution error, not a protocol error', async () => {
    const result = await client.callTool({
      name: 'review_pull_request',
      arguments: { repo: 'nope/nothing', pull_number: 1 },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('No repository "nope/nothing"');
  });

  it('get_findings: defaults to concise projection and limit 20', async () => {
    const result = await client.callTool({ name: 'get_findings', arguments: { run_id: MOCK_RUN_ID } });
    const body = JSON.parse(textOf(result));
    expect(body.findings).toHaveLength(2);
    expect(body.findings[0]).toEqual({
      file: expect.any(String),
      line: expect.any(Number),
      severity: expect.any(String),
      title: expect.any(String),
    });
  });

  // Regression: `severity`/`category` were array-only, so the natural single-value
  // spelling `severity: "CRITICAL"` failed validation and cost a turn — while the
  // route being wrapped (`RunFindingsQuery`) already accepted either. Both
  // spellings must now filter identically.
  it('get_findings: a scalar severity filters the same as a one-element array', async () => {
    const scalar = await client.callTool({
      name: 'get_findings',
      arguments: { run_id: MOCK_RUN_ID, severity: 'CRITICAL' },
    });
    const array = await client.callTool({
      name: 'get_findings',
      arguments: { run_id: MOCK_RUN_ID, severity: ['CRITICAL'] },
    });
    expect(scalar.isError).toBeFalsy();
    expect(textOf(scalar)).toBe(textOf(array));
    const body = JSON.parse(textOf(scalar));
    expect(body.findings.every((f: { severity: string }) => f.severity === 'CRITICAL')).toBe(true);
    expect(body.findings.length).toBeGreaterThan(0);
  });

  it('get_repo_conventions: a scalar status is accepted like a one-element array', async () => {
    const scalar = await client.callTool({
      name: 'get_repo_conventions',
      arguments: { repo: 'acme/web', status: 'accepted' },
    });
    const array = await client.callTool({
      name: 'get_repo_conventions',
      arguments: { repo: 'acme/web', status: ['accepted'] },
    });
    expect(scalar.isError).toBeFalsy();
    expect(textOf(scalar)).toBe(textOf(array));
  });

  it('get_findings: still-executing run returns the verbatim progress error', async () => {
    const startResult = await client.callTool({
      name: 'review_pull_request',
      arguments: { repo: 'acme/web', pull_number: 42 },
    });
    const runId = JSON.parse(textOf(startResult)).runs[0].run_id as string;
    const result = await client.callTool({ name: 'get_findings', arguments: { run_id: runId } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('is still executing');
    expect(textOf(result)).toContain('Do not call review_pull_request again.');
  });

  it('get_findings: both run_id and repo is a tool error naming the choice', async () => {
    const result = await client.callTool({
      name: 'get_findings',
      arguments: { run_id: MOCK_RUN_ID, repo: 'acme/web', pull_number: 42 },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Pass either run_id or repo+pull_number, not both.');
  });

  it('get_repo_conventions: defaults to accepted-only, concise projection', async () => {
    const result = await client.callTool({ name: 'get_repo_conventions', arguments: { repo: 'acme/web' } });
    const body = JSON.parse(textOf(result));
    expect(body.conventions).toHaveLength(1);
    expect(body.conventions[0]).not.toHaveProperty('evidence_snippet');
    expect(body.scan_status).toBe('done');
  });

  it('get_repo_conventions: unknown repo names the closest match', async () => {
    const result = await client.callTool({ name: 'get_repo_conventions', arguments: { repo: 'acme/wb' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Did you mean "acme/web"?');
  });

  it('get_blast_radius: always isError, never calls the port', async () => {
    const result = await client.callTool({
      name: 'get_blast_radius',
      arguments: { repo: 'acme/web', pull_number: 42 },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'get_blast_radius is not implemented yet. For impact analysis on this pull request, call ' +
        'get_findings (severity: ["CRITICAL"]) and get_repo_conventions instead.',
    );
  });

  it('tools/list ordering is stable across repeated calls on the same server', async () => {
    const first = (await client.listTools()).tools.map((t) => t.name);
    const second = (await client.listTools()).tools.map((t) => t.name);
    expect(second).toEqual(first);
  });

  it('tools/list ordering is stable across independently-built server instances', async () => {
    const { client: otherClient, server: otherServer } = await connect();
    const a = (await client.listTools()).tools.map((t) => t.name);
    const b = (await otherClient.listTools()).tools.map((t) => t.name);
    expect(b).toEqual(a);
    await otherClient.close();
    await otherServer.close();
  });
});

/**
 * `grounding` exists because `findings: []` on a `done` run is ambiguous: a
 * review that examined a real diff and found nothing looks identical to one
 * handed an empty diff. Observed live on acme/payments-api#482, whose four files
 * all carry `patch: NULL` — the run completed, spent tokens, and reported zero
 * findings with grounding "0/0 passed".
 */
describe('get_findings — grounding disambiguates an empty result', () => {
  it('surfaces the run grounding tally in run_id mode', async () => {
    const { client, server } = await connect();
    const result = await client.callTool({ name: 'get_findings', arguments: { run_id: MOCK_RUN_ID } });
    const body = JSON.parse(textOf(result));
    expect(body.grounding).toBe('2/2 passed');
    expect(body.run_status).toBe('done');
    await client.close();
    await server.close();
  });

  it('omits grounding in repo+pull_number mode, where it would be one run out of several', async () => {
    const { client, server } = await connect();
    const result = await client.callTool({
      name: 'get_findings',
      arguments: { repo: 'acme/web', pull_number: 42 },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).not.toHaveProperty('grounding');
    await client.close();
    await server.close();
  });
});

/**
 * Regression, found by two reviewers independently: `run_id` was an
 * unconstrained `z.string()` and reached the URL path directly, so the tool
 * argument could re-address the request. `.uuid()` matches the wrapped route's
 * own `IdParams`, so the tool is exactly as strict as the endpoint — no
 * stricter, which is the bar mcp/INSIGHTS.md sets.
 */
describe('get_findings — run_id is constrained to a uuid', () => {
  it('rejects a path-traversal run id as a validation error', async () => {
    const { client, server } = await connect();
    const result = await client.callTool({
      name: 'get_findings',
      arguments: { run_id: '../settings?x=' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/uuid|Invalid/i);
    await client.close();
    await server.close();
  });

  it('still accepts a real uuid', async () => {
    const { client, server } = await connect();
    const result = await client.callTool({
      name: 'get_findings',
      arguments: { run_id: '00000000-0000-4000-8000-000000000001' },
    });
    // Unknown-but-well-formed id: the mock has no such run, so this is a tool
    // error about the run, not about the argument shape.
    expect(textOf(result)).not.toMatch(/uuid/i);
    await client.close();
    await server.close();
  });
});

/**
 * Regression: a cursor that does not decode used to collapse to offset 0, so the
 * caller was handed page one again as if it were the next page. The route this
 * wraps answers the same input with a 400.
 */
describe('get_findings — a bad cursor is an error, not page one', () => {
  it('names the two cursor formats instead of re-serving the first page', async () => {
    const { client, server } = await connect();
    const result = await client.callTool({
      name: 'get_findings',
      arguments: { repo: 'acme/web', pull_number: 42, cursor: 'not-a-real-cursor' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid cursor');
    expect(textOf(result)).toContain('not interchangeable');
    await client.close();
    await server.close();
  });
});
