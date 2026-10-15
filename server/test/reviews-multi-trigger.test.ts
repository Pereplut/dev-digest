/**
 * POST /pulls/:id/review fan-out (spec 0021, AC-1..AC-5) — service level,
 * hermetic. The repository and the agents repository are hand-rolled stubs
 * (server/INSIGHTS.md 2026-09-18: a cast stub implements only what this path
 * calls — widen it whenever the service starts calling a new method).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Container } from '../src/platform/container.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import type { AgentRow } from '../src/db/rows.js';
import { ReviewService } from '../src/modules/reviews/service.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import { AppError } from '../src/platform/errors.js';

const WS = 'ws-1';
const PR = '11111111-1111-4111-8111-111111111111';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function agent(n: number, over: Partial<AgentRow> = {}): AgentRow {
  return {
    id: id(n), workspaceId: WS, name: `Agent ${n}`, description: '', provider: 'openai', model: 'gpt-4.1',
    systemPrompt: 's', outputSchema: null, strategy: 'single-pass', ciFailOn: 'critical', repoIntel: false,
    enabled: true, version: 1, createdBy: null, createdAt: new Date('2026-01-01T00:00:00Z'), ...over,
  } as AgentRow;
}

function build(agents: AgentRow[]) {
  const createAgentRun = vi.fn(async () => `run-${Math.random()}`);
  const createMultiAgentRun = vi.fn(async () => 'multi-1');
  const repo = {
    getPull: vi.fn(async () => ({ id: PR, repoId: 'repo-1' })),
    getRepo: vi.fn(async () => ({ id: 'repo-1' })),
    createAgentRun,
    createMultiAgentRun,
    transaction: vi.fn(async (cb: (r: unknown) => unknown) => cb(repo)),
  };
  const agentsRepo = {
    listByIds: vi.fn(async (_ws: string, ids: string[]) => agents.filter((a) => ids.includes(a.id))),
    listEnabled: vi.fn(async () => agents.filter((a) => a.enabled)),
    getById: vi.fn(async (_ws: string, aid: string) => agents.find((a) => a.id === aid)),
  };
  const container = { agentsRepo } as unknown as Container;
  const service = new ReviewService(container, repo as unknown as ReviewRepository);
  return { service, repo, createAgentRun, createMultiAgentRun, agentsRepo };
}

async function run(service: ReviewService, body: Parameters<ReviewService['resolveTargets']>[1]) {
  const targets = await service.resolveTargets(WS, body);
  return service.runReview(WS, PR, targets);
}

describe('ReviewService fan-out trigger', () => {
  beforeEach(() => {
    vi.spyOn(ReviewRunExecutor.prototype, 'executeRuns').mockResolvedValue();
  });
  afterEach(() => vi.restoreAllMocks());

  it('2 valid ids create 2 stamped runs under one parent and return multi_run_id', async () => {
    const { service, createAgentRun, createMultiAgentRun } = build([agent(1), agent(2)]);
    const res = await run(service, { agent_ids: [id(1), id(2)] });
    expect(createMultiAgentRun).toHaveBeenCalledTimes(1);
    expect(createAgentRun).toHaveBeenCalledTimes(2);
    for (const call of createAgentRun.mock.calls) {
      expect((call as unknown as [{ multiRunId: string }])[0].multiRunId).toBe('multi-1');
    }
    expect(res.multi_run_id).toBe('multi-1');
    expect(res.runs.map((r) => r.agent_id)).toEqual([id(1), id(2)]);
  });

  it('all:true with 3 enabled agents creates one parent', async () => {
    const { service, createMultiAgentRun, createAgentRun } = build([agent(1), agent(2), agent(3)]);
    const res = await run(service, { all: true });
    expect(createMultiAgentRun).toHaveBeenCalledTimes(1);
    expect(createAgentRun).toHaveBeenCalledTimes(3);
    expect(res.multi_run_id).toBe('multi-1');
  });

  const bad: [string, Parameters<ReviewService['resolveTargets']>[1]][] = [
    ['empty', { agent_ids: [] }],
    ['11 ids', { agent_ids: Array.from({ length: 11 }, (_, i) => id(i + 1)) }],
    ['duplicate', { agent_ids: [id(1), id(1)] }],
    ['non-uuid', { agent_ids: ['nope', id(1)] }],
    ['unknown', { agent_ids: [id(1), id(99)] }],
    ['disabled', { agent_ids: [id(1), id(4)] }],
    ['agentId + agent_ids', { agentId: id(1), agent_ids: [id(1), id(2)] }],
    ['all + agent_ids', { all: true, agent_ids: [id(1), id(2)] }],
    ['agentId + all', { agentId: id(1), all: true }],
  ];
  it.each(bad)('%s -> 400 and nothing is created', async (_name, body) => {
    const { service, createAgentRun, createMultiAgentRun } = build([
      ...Array.from({ length: 3 }, (_, i) => agent(i + 1)),
      agent(4, { enabled: false }),
    ]);
    const err = await run(service, body).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(400);
    expect(createAgentRun).not.toHaveBeenCalled();
    expect(createMultiAgentRun).not.toHaveBeenCalled();
  });

  it('a foreign-workspace id (absent from the scoped lookup) is a 400', async () => {
    const { service, agentsRepo } = build([agent(1)]);
    agentsRepo.listByIds.mockResolvedValue([agent(1)]);
    const err = await service.resolveTargets(WS, { agent_ids: [id(1), id(7)] }).catch((e: unknown) => e);
    expect((err as AppError).statusCode).toBe(400);
  });

  it('1 id -> multi_run_id null, no parent, no multiRunId stamped', async () => {
    const { service, createAgentRun, createMultiAgentRun } = build([agent(1), agent(2)]);
    const res = await run(service, { agent_ids: [id(1)] });
    expect(res.multi_run_id).toBeNull();
    expect(createMultiAgentRun).not.toHaveBeenCalled();
    expect((createAgentRun.mock.calls[0] as unknown as [Record<string, unknown>])[0]).not.toHaveProperty('multiRunId');
  });

  it('a disabled agent via agentId still runs alone (AC-5)', async () => {
    const { service, createAgentRun } = build([agent(4, { enabled: false })]);
    const res = await run(service, { agentId: id(4) });
    expect(createAgentRun).toHaveBeenCalledTimes(1);
    expect(res.multi_run_id).toBeNull();
  });
});
