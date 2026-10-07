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
