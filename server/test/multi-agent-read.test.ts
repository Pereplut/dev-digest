/** toMultiAgentRun (spec 0021, AC-14/15): totals, number costs, null agent, null status. Pure. */
import { describe, it, expect } from 'vitest';
import { toMultiAgentRun, type MultiAgentChildInput } from '../src/modules/reviews/helpers.js';

const parent = { id: 'm1', prId: 'p1', prNumber: 7, prTitle: 'T', ranAt: new Date('2026-10-15T00:00:00Z') };
const child = (n: number, over: Partial<MultiAgentChildInput> = {}): MultiAgentChildInput => ({
  runId: `r${n}`, agentId: `a${n}`, agentName: `Agent ${n}`, provider: 'openai', model: 'm',
  status: 'done', error: null, durationMs: 100, costUsd: 0.01, ...over,
});
const build = (children: MultiAgentChildInput[]) => toMultiAgentRun(parent, children, new Map());

describe('toMultiAgentRun', () => {
  it('total duration is the max non-null, 0 when all null', () => {
    expect(build([child(1, { durationMs: 1200 }), child(2, { durationMs: null }), child(3, { durationMs: 800 })]).total_duration_ms).toBe(1200);
    expect(build([child(1, { durationMs: null })]).total_duration_ms).toBe(0);
  });

  it('total cost is a null-safe sum, null when all null', () => {
    const r = build([child(1, { costUsd: 0.01 }), child(2, { costUsd: null }), child(3, { costUsd: 0.02 })]);
    expect(r.total_cost_usd).toBeCloseTo(0.03, 10);
    expect(build([child(1, { costUsd: null })]).total_cost_usd).toBeNull();
  });

  it('column costs are JSON numbers', () => {
    const r = build([child(1, { costUsd: 0.5 })]);
    expect(typeof r.columns[0]!.cost_usd).toBe('number');
  });

  it('a deleted agent yields agent_id/agent_name null', () => {
    const c = build([child(1, { agentId: null, agentName: null })]).columns[0]!;
    expect(c.agent_id).toBeNull();
    expect(c.agent_name).toBeNull();
  });

  it('a null status falls back to running; cancelled is kept', () => {
    const r = build([child(1, { status: null }), child(2, { status: 'cancelled' })]);
    expect(r.columns.map((c) => c.status)).toEqual(['running', 'cancelled']);
  });

  it('agent_count and PR fields come through', () => {
    const r = build([child(1), child(2)]);
    expect(r).toMatchObject({ agent_count: 2, pr_id: 'p1', pr_number: 7, pr_title: 'T', ran_at: '2026-10-15T00:00:00.000Z' });
  });
});
