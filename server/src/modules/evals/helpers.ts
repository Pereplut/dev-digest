import type { EvalBatchRecord, EvalCase, EvalRunRecord } from '@devdigest/shared';
import type { EvalCaseRow, EvalRunBatchRow, EvalRunRow } from '../../db/rows.js';

/**
 * Pure helpers for the evals module (spec 0019): the batch rollup math and row
 * → DTO mapping. No DB, no container, no `this` — `pnpm arch`'s
 * `no-cross-module-internals` rule classifies by FILENAME, not behaviour (its
 * `to.path` only matches `(service|repository)`), so it cannot verify this
 * file stays pure. It earns the "helpers.ts" name by actually being pure
 * (server/INSIGHTS.md:472-478) — never add I/O, a repository call, or
 * `container` here.
 */

// ---- Batch rollup (AC-18, AC-19, AC-20, AC-65) -----------------------------

/** One case's contribution to the batch rollup. */
export interface EvalCaseResult {
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  /** USD cost of this one case's model call; `null` when unpriced. */
  costUsd: number | null;
}

export interface BatchRollup {
  casesTotal: number;
  casesPassed: number;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number;
  /** `null` if ANY case's cost is `null` — never a partial sum (AC-65). */
  costUsd: number | null;
}

function meanNonNull(values: (number | null)[]): number | null {
  const nonNull = values.filter((v): v is number => v !== null);
  if (nonNull.length === 0) return null;
  return nonNull.reduce((sum, v) => sum + v, 0) / nonNull.length;
}

/**
 * Decimal sum with no binary-float accumulator: every cost is scaled to an
 * integer at 6 decimal places, summed as integers, then scaled back ONCE — the
 * only floating-point division in the whole function. `null` the moment any
 * case's cost is `null`: one unpriced model makes the whole batch's cost
 * unknown, not smaller (reviewer-core/INSIGHTS.md:9-15).
 */
function sumCostUsd(values: (number | null)[]): number | null {
  if (values.length === 0 || values.some((v) => v === null)) return null;
  const scaledSum = values.reduce<number>((sum, v) => sum + Math.round((v as number) * 1_000_000), 0);
  return scaledSum / 1_000_000;
}

/**
 * Roll up a batch's per-case results. `startedAtMs`/`nowMs` are plain numbers
 * (not an injected clock function) so a test can pin both ends directly
 * without faking a global timer.
 */
export function rollupBatch(cases: EvalCaseResult[], startedAtMs: number, nowMs: number): BatchRollup {
  return {
    casesTotal: cases.length,
    casesPassed: cases.filter((c) => c.pass === true).length,
    recall: meanNonNull(cases.map((c) => c.recall)),
    precision: meanNonNull(cases.map((c) => c.precision)),
    citationAccuracy: meanNonNull(cases.map((c) => c.citationAccuracy)),
    durationMs: nowMs - startedAtMs,
    costUsd: sumCostUsd(cases.map((c) => c.costUsd)),
  };
}

// ---- Row -> DTO mapping -----------------------------------------------------

export function toEvalCaseDto(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind as EvalCase['owner_kind'],
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles,
    input_meta: row.inputMeta,
    expected_output: row.expectedOutput,
    notes: row.notes,
    expectation_kind: row.expectationKind as EvalCase['expectation_kind'],
    expected_file: row.expectedFile,
    expected_start_line: row.expectedStartLine,
    expected_end_line: row.expectedEndLine,
    source_finding_id: row.sourceFindingId,
    created_at: row.createdAt.toISOString(),
  };
}

export function toEvalBatchRecordDto(row: EvalRunBatchRow): EvalBatchRecord {
  return {
    id: row.id,
    owner_kind: row.ownerKind as EvalBatchRecord['owner_kind'],
    owner_id: row.ownerId,
    agent_id: row.agentId,
    agent_version: row.agentVersion,
    ran_at: row.ranAt.toISOString(),
    status: row.status as EvalBatchRecord['status'],
    error: row.error,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    cases_total: row.casesTotal,
    cases_passed: row.casesPassed,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd == null ? null : Number(row.costUsd),
  };
}

export function toEvalRunRecordDto(row: EvalRunRow & { caseName?: string | null }): EvalRunRecord {
  return {
    id: row.id,
    case_id: row.caseId,
    case_name: row.caseName ?? null,
    ran_at: row.ranAt.toISOString(),
    actual_output: row.actualOutput,
    pass: row.pass,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd == null ? null : Number(row.costUsd),
  };
}
