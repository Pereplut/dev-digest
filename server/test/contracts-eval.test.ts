import { describe, it, expect } from 'vitest';
import {
  EvalExpectationKind,
  EvalBatchRecord,
  EvalCaseFromFindingInput,
  EvalCasePatch,
  EvalBatchDetail,
  EvalCaseInput,
  EvalRunRecord,
  EvalCase,
  EvalTrendPoint,
  EvalDashboard,
  EvalRunComparison,
  EvalPromoteResult,
} from '@devdigest/shared';

/**
 * Spec 0019, wave 1 — the shared contracts that gate everything else.
 * AC-6, AC-7, AC-8 (server half), AC-77, AC-78, AC-79.
 */
describe('eval contracts (spec 0019, wave 1)', () => {
  it('AC-6: EvalExpectationKind, EvalBatchRecord and EvalCaseFromFindingInput are exported from the barrel', () => {
    expect(EvalExpectationKind).toBeDefined();
    expect(EvalBatchRecord).toBeDefined();
    expect(EvalCaseFromFindingInput).toBeDefined();
    expect(() => EvalExpectationKind.parse('must_find')).not.toThrow();
    expect(() => EvalExpectationKind.parse('must_not_flag')).not.toThrow();
    expect(() => EvalExpectationKind.parse('maybe')).toThrow();
    expect(() =>
      EvalCaseFromFindingInput.parse({ finding_id: '11111111-1111-1111-1111-111111111111' }),
    ).not.toThrow();
  });

  it('finding_id is uuid-validated like every other id param (schemas.ts:11) — a malformed id is rejected at the contract layer, not a 500 from Postgres\' 22P02', () => {
    expect(() => EvalCaseFromFindingInput.parse({ finding_id: 'f1' })).toThrow();
    expect(() => EvalCaseFromFindingInput.parse({ finding_id: 'abc' })).toThrow();
  });

  it('AC-6: a pre-existing export (EvalCaseInput) still round-trips — nothing renamed or removed', () => {
    const input = {
      owner_kind: 'agent',
      owner_id: 'agent-1',
      name: 'case 1',
      input_diff: 'diff --git a/a.ts b/a.ts',
      expected_output: { foo: 'bar' },
    };
    expect(() => EvalCaseInput.parse(input)).not.toThrow();
  });

  it('AC-7: EvalBatchRecord accepts each of the five statuses and rejects an unknown one', () => {
    const base = {
      id: 'b1',
      owner_kind: 'agent',
      owner_id: 'agent-1',
      agent_id: 'agent-1',
      agent_version: 3,
      ran_at: '2026-10-07T00:00:00.000Z',
      error: null,
      recall: 0.5,
      precision: 0.5,
      citation_accuracy: 1,
      cases_total: 2,
      cases_passed: 1,
      duration_ms: 1200,
      cost_usd: 0.000123,
      metrics_version: 2,
    };
    for (const status of ['queued', 'running', 'done', 'failed', 'cancelled']) {
      expect(() => EvalBatchRecord.parse({ ...base, status })).not.toThrow();
    }
    expect(() => EvalBatchRecord.parse({ ...base, status: 'paused' })).toThrow();
  });

  it('AC-78: EvalCasePatch makes every field optional and still enforces the expectation_kind enum', () => {
    expect(() => EvalCasePatch.parse({})).toThrow();
    expect(() => EvalCasePatch.parse({ expectation_kind: 'maybe' })).toThrow();
    expect(() =>
      EvalCasePatch.parse({ name: 'renamed', expectation_kind: 'must_not_flag' }),
    ).not.toThrow();
  });

  it('EvalCasePatch rejects an unknown field instead of silently stripping it (a misspelled key is now a 422, not a no-op)', () => {
    expect(() => EvalCasePatch.parse({ nmae: 'typo' })).toThrow();
  });

  it('AC-79: EvalBatchDetail wraps a batch with an array of the existing EvalRunRecord shape', () => {
    const batch = EvalBatchRecord.parse({
      id: 'b1',
      owner_kind: 'agent',
      owner_id: 'agent-1',
      agent_id: 'agent-1',
      agent_version: 1,
      ran_at: '2026-10-07T00:00:00.000Z',
      status: 'done',
      error: null,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      cases_total: 1,
      cases_passed: 1,
      duration_ms: 500,
      cost_usd: 0.00001,
      metrics_version: 2,
    });
    const run = EvalRunRecord.parse({
      id: 'r1',
      case_id: 'c1',
      case_name: 'case 1',
      ran_at: '2026-10-07T00:00:00.000Z',
      actual_output: {},
      pass: true,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      duration_ms: 500,
      cost_usd: 0.00001,
    });
    expect(() => EvalBatchDetail.parse({ batch, runs: [] })).not.toThrow();
    expect(() => EvalBatchDetail.parse({ batch, runs: [run] })).not.toThrow();
  });

  it('AC-77: EvalCase carries the six new fields additively, with every pre-existing field surviving', () => {
    const preExistingKeys = [
      'id',
      'owner_kind',
      'owner_id',
      'name',
      'input_diff',
      'input_files',
      'input_meta',
      'expected_output',
      'notes',
    ];
    const row = {
      id: 'c1',
      owner_kind: 'agent',
      owner_id: 'agent-1',
      name: 'case 1',
      input_diff: 'diff --git a/a.ts b/a.ts',
      input_files: null,
      input_meta: null,
      expected_output: null,
      notes: null,
      expectation_kind: 'must_find',
      expected_file: 'src/a.ts',
      expected_start_line: 1,
      expected_end_line: 4,
      source_finding_id: 'finding-1',
      created_at: '2026-10-07T00:00:00.000Z',
    };
    const parsed = EvalCase.parse(row);
    for (const key of preExistingKeys) {
      expect(Object.keys(parsed)).toContain(key);
    }
    expect(parsed.expectation_kind).toBe('must_find');
    expect(parsed.source_finding_id).toBe('finding-1');

    // Nullable — a hand-written case (0020, out of scope here) has no source finding.
    expect(() => EvalCase.parse({ ...row, source_finding_id: null })).not.toThrow();
    // NOT NULL in the schema (AC-3) — the DTO rejects a missing expectation_kind.
    const { expectation_kind: _expectationKind, ...withoutKind } = row;
    expect(() => EvalCase.parse(withoutKind)).toThrow();
  });
});

/**
 * Spec 0020, wave 1 (S1) — EvalBatchRecord.metrics_version, the three nullable
 * metrics, EvalDashboard.recent_runs/trend_excluded, EvalRunComparison and
 * EvalPromoteResult. AC-4 – AC-9, AC-82.
 */
describe('eval contracts (spec 0020, wave 1)', () => {
  const batch = (overrides: Record<string, unknown> = {}) => ({
    id: 'b1',
    owner_kind: 'agent',
    owner_id: 'agent-1',
    agent_id: 'agent-1',
    agent_version: 3,
    ran_at: '2026-10-07T00:00:00.000Z',
    status: 'done',
    error: null,
    recall: 0.5,
    precision: 0.5,
    citation_accuracy: 1,
    cases_total: 2,
    cases_passed: 1,
    duration_ms: 1200,
    cost_usd: 0.000123,
    metrics_version: 2,
    ...overrides,
  });

  const allNullTrendPoint = {
    ran_at: '2026-10-07T00:00:00.000Z',
    recall: null,
    precision: null,
    citation_accuracy: null,
    pass_rate: 0,
    cost_usd: null,
  };

  const allNullDashboard = {
    owner_kind: 'agent',
    owner_id: 'agent-1',
    cases_total: 0,
    current: {
      recall: null,
      precision: null,
      citation_accuracy: null,
      traces_passed: 0,
      traces_total: 0,
      cost_usd: null,
    },
    delta: {
      recall: null,
      precision: null,
      citation_accuracy: null,
    },
    trend: [],
    recent_runs: [],
    alert: null,
    trend_excluded: { other_version: 0, incomplete_metrics: 0 },
  };

  it('AC-4: EvalBatchRecord carries metrics_version as a required integer', () => {
    expect(() => EvalBatchRecord.parse(batch())).not.toThrow();
    expect(() => EvalBatchRecord.parse(batch({ metrics_version: '2' }))).toThrow();
    const { metrics_version: _mv, ...withoutVersion } = batch();
    expect(() => EvalBatchRecord.parse(withoutVersion)).toThrow();
  });

  it('AC-5/AC-6: an all-null EvalTrendPoint and EvalDashboard — which failed to parse before this change — now parse', () => {
    expect(() => EvalTrendPoint.parse(allNullTrendPoint)).not.toThrow();
    expect(() => EvalDashboard.parse(allNullDashboard)).not.toThrow();
  });

  it('EvalTrendPoint still rejects a wrong-typed metric (recall as a string)', () => {
    expect(() => EvalTrendPoint.parse({ ...allNullTrendPoint, recall: '0.8' })).toThrow();
  });

  it('AC-7: EvalDashboard.recent_runs accepts EvalBatchRecord rows and rejects an EvalRunRecord row', () => {
    const b1 = batch();
    const b2 = batch({ id: 'b2', agent_version: 4 });
    expect(() =>
      EvalDashboard.parse({ ...allNullDashboard, recent_runs: [b1, b2] }),
    ).not.toThrow();

    const runRecord = {
      id: 'r1',
      case_id: 'c1',
      case_name: 'case 1',
      ran_at: '2026-10-07T00:00:00.000Z',
      actual_output: {},
      pass: true,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      duration_ms: 500,
      cost_usd: 0.00001,
    };
    expect(() =>
      EvalDashboard.parse({ ...allNullDashboard, recent_runs: [runRecord] }),
    ).toThrow();
  });

  it('AC-82: EvalDashboard.trend_excluded rejects a negative count', () => {
    expect(() =>
      EvalDashboard.parse({
        ...allNullDashboard,
        trend_excluded: { other_version: -1, incomplete_metrics: 0 },
      }),
    ).toThrow();
    expect(() =>
      EvalDashboard.parse({
        ...allNullDashboard,
        trend_excluded: { other_version: 0, incomplete_metrics: -1 },
      }),
    ).toThrow();
  });

  it('key-set snapshot: EvalBatchRecord gained exactly metrics_version, nothing else renamed', () => {
    expect(Object.keys(EvalBatchRecord.shape).sort()).toEqual(
      [
        'id',
        'owner_kind',
        'owner_id',
        'agent_id',
        'agent_version',
        'ran_at',
        'status',
        'error',
        'recall',
        'precision',
        'citation_accuracy',
        'cases_total',
        'cases_passed',
        'duration_ms',
        'cost_usd',
        'metrics_version',
      ].sort(),
    );
  });

  it('key-set snapshot: EvalTrendPoint key set is unchanged', () => {
    expect(Object.keys(EvalTrendPoint.shape).sort()).toEqual(
      ['ran_at', 'recall', 'precision', 'citation_accuracy', 'pass_rate', 'cost_usd'].sort(),
    );
  });

  it('key-set snapshot: EvalDashboard gained exactly trend_excluded, nothing else renamed', () => {
    expect(Object.keys(EvalDashboard.shape).sort()).toEqual(
      [
        'owner_kind',
        'owner_id',
        'cases_total',
        'current',
        'delta',
        'trend',
        'recent_runs',
        'alert',
        'trend_excluded',
      ].sort(),
    );
  });

  it('AC-8: EvalRunComparison accepts a null config with a null metric delta, and rejects a non-boolean comparable', () => {
    const comparison = {
      old: batch(),
      new: batch({ id: 'b2', agent_version: 4 }),
      old_config: null,
      new_config: null,
      comparable: false,
      incomparable_reason: 'metrics_version_mismatch',
      delta: {
        recall: null,
        precision: null,
        citation_accuracy: null,
        cost_usd: 0.001,
      },
    };
    expect(() => EvalRunComparison.parse(comparison)).not.toThrow();
    expect(() => EvalRunComparison.parse({ ...comparison, comparable: 'false' })).toThrow();
  });

  it('AC-9: EvalPromoteResult accepts an empty skills_not_restored and rejects a missing agent', () => {
    const agent = {
      id: 'agent-1',
      name: 'Agent',
      description: '',
      provider: 'openai',
      model: 'gpt-4.1',
      system_prompt: 'review carefully',
      enabled: true,
      version: 3,
    };
    expect(() =>
      EvalPromoteResult.parse({ agent, version: 3, skills_not_restored: [] }),
    ).not.toThrow();
    expect(() => EvalPromoteResult.parse({ version: 3, skills_not_restored: [] })).toThrow();
  });
});
