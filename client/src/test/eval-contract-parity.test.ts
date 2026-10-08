import { describe, it, expect } from "vitest";

// Deliberately NOT imported through the `@devdigest/shared` alias: that alias
// always resolves to this package's own vendored copy, and a value import of
// it from client code breaks `next build` (client/INSIGHTS.md:83-89). This
// file is a test, never bundled by Next, so a direct relative read of BOTH
// copies — this package's vendored one and the server's canonical one — is
// the only way to compare them at all.
import {
  EvalBatchRecord as ServerEvalBatchRecord,
  EvalRunRecord as ServerEvalRunRecord,
  EvalTrendPoint as ServerEvalTrendPoint,
  EvalDashboard as ServerEvalDashboard,
  EvalRunComparison as ServerEvalRunComparison,
  EvalPromoteResult as ServerEvalPromoteResult,
} from "../../../server/src/vendor/shared/contracts/eval-ci";
import { EvalCase as ServerEvalCase } from "../../../server/src/vendor/shared/contracts/knowledge";

import {
  EvalBatchRecord as ClientEvalBatchRecord,
  EvalRunRecord as ClientEvalRunRecord,
  EvalTrendPoint as ClientEvalTrendPoint,
  EvalDashboard as ClientEvalDashboard,
  EvalRunComparison as ClientEvalRunComparison,
  EvalPromoteResult as ClientEvalPromoteResult,
} from "../vendor/shared/contracts/eval-ci";
import { EvalCase as ClientEvalCase } from "../vendor/shared/contracts/knowledge";

/**
 * Spec 0019, AC-8: the client's vendored copy mirrors the spec's changes to
 * both `eval-ci.ts` and `knowledge.ts`, field-for-field, with no unrelated
 * change — the two copies have already drifted elsewhere (root
 * INSIGHTS.md:30-38), so byte-identity is the wrong bar; `safeParse` parity
 * over a shared fixture table is.
 */
describe("eval contract parity: server vs client vendored copies (spec 0019, AC-8)", () => {
  const validBatch = {
    id: "b1",
    owner_kind: "agent",
    owner_id: "agent-1",
    agent_id: "agent-1",
    agent_version: 2,
    ran_at: "2026-10-07T00:00:00.000Z",
    status: "done",
    error: null,
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 1,
    cases_total: 5,
    cases_passed: 4,
    duration_ms: 12000,
    cost_usd: 0.000456,
    metrics_version: 2,
  };

  const { agent_id: _agentId, ...batchMissingAgentId } = validBatch;

  const batchFixtures: { label: string; value: unknown }[] = [
    { label: "valid batch", value: validBatch },
    { label: "unknown status member", value: { ...validBatch, status: "paused" } },
    { label: "wrong type for cases_total", value: { ...validBatch, cases_total: "five" } },
    { label: "missing required field", value: batchMissingAgentId },
    { label: "missing metrics_version (spec 0020)", value: (() => {
      const { metrics_version: _mv, ...rest } = validBatch;
      return rest;
    })() },
  ];

  it.each(batchFixtures)("EvalBatchRecord: $label parses identically in both copies", ({ value }) => {
    const server = ServerEvalBatchRecord.safeParse(value);
    const client = ClientEvalBatchRecord.safeParse(value);
    expect(client.success).toBe(server.success);
  });

  const validCase = {
    id: "c1",
    owner_kind: "agent",
    owner_id: "agent-1",
    name: "case 1",
    input_diff: "diff --git a/a.ts b/a.ts",
    input_files: null,
    input_meta: null,
    expected_output: null,
    notes: null,
    expectation_kind: "must_find",
    expected_file: "src/a.ts",
    expected_start_line: 1,
    expected_end_line: 4,
    source_finding_id: "finding-1",
    created_at: "2026-10-07T00:00:00.000Z",
  };

  const { expectation_kind: _expectationKind, ...caseMissingExpectationKind } = validCase;

  const caseFixtures: { label: string; value: unknown }[] = [
    { label: "valid case", value: validCase },
    { label: "unknown expectation_kind member", value: { ...validCase, expectation_kind: "maybe" } },
    {
      label: "wrong type for expected_start_line",
      value: { ...validCase, expected_start_line: "one" },
    },
    { label: "missing NOT NULL expectation_kind", value: caseMissingExpectationKind },
  ];

  it.each(caseFixtures)("EvalCase: $label parses identically in both copies", ({ value }) => {
    const server = ServerEvalCase.safeParse(value);
    const client = ClientEvalCase.safeParse(value);
    expect(client.success).toBe(server.success);
  });

  /**
   * Spec 0020, S2: the client's `EvalTrendPoint`, `EvalDashboard`,
   * `EvalRunComparison` and `EvalPromoteResult` mirror the server's, field-for-
   * field — AC-10. `EvalRunComparison`/`EvalPromoteResult` are new exports in
   * both copies, so "parity" here means both copies agree on every fixture,
   * not that either one is independently correct (that is contracts-eval's job).
   */
  const validTrendPoint = {
    ran_at: "2026-10-07T00:00:00.000Z",
    recall: null,
    precision: 0.5,
    citation_accuracy: 1,
    pass_rate: 0.5,
    cost_usd: 0.0001,
  };
  const trendPointFixtures: { label: string; value: unknown }[] = [
    { label: "valid, with a null metric", value: validTrendPoint },
    { label: "valid, no null metric", value: { ...validTrendPoint, recall: 0.9 } },
    { label: "wrong type for recall", value: { ...validTrendPoint, recall: "0.8" } },
    { label: "missing pass_rate", value: (() => {
      const { pass_rate: _pr, ...rest } = validTrendPoint;
      return rest;
    })() },
    { label: "unknown extra field (strips, does not reject)", value: { ...validTrendPoint, bogus: 1 } },
  ];
  it.each(trendPointFixtures)("EvalTrendPoint: $label parses identically in both copies", ({ value }) => {
    expect(ClientEvalTrendPoint.safeParse(value).success).toBe(
      ServerEvalTrendPoint.safeParse(value).success,
    );
  });

  const validDashboard = {
    owner_kind: "agent",
    owner_id: "agent-1",
    cases_total: 5,
    current: {
      recall: null,
      precision: 0.5,
      citation_accuracy: 1,
      traces_passed: 2,
      traces_total: 5,
      cost_usd: 0.001,
    },
    delta: { recall: null, precision: 0.1, citation_accuracy: 0 },
    trend: [],
    recent_runs: [validBatch],
    alert: null,
    trend_excluded: { other_version: 0, incomplete_metrics: 0 },
  };
  const dashboardFixtures: { label: string; value: unknown }[] = [
    { label: "valid, all-null metrics", value: {
      ...validDashboard,
      current: { ...validDashboard.current, recall: null, precision: null, citation_accuracy: null },
      delta: { recall: null, precision: null, citation_accuracy: null },
    } },
    { label: "valid, recent_runs holds batches", value: validDashboard },
    { label: "negative trend_excluded.other_version", value: {
      ...validDashboard,
      trend_excluded: { other_version: -1, incomplete_metrics: 0 },
    } },
    { label: "recent_runs holding an EvalRunRecord instead of a batch", value: {
      ...validDashboard,
      recent_runs: [{ id: "r1", case_id: "c1", ran_at: "2026-10-07T00:00:00.000Z", actual_output: {}, pass: true, recall: 1, precision: 1, citation_accuracy: 1, duration_ms: 1, cost_usd: 1 }],
    } },
    { label: "missing trend_excluded", value: (() => {
      const { trend_excluded: _te, ...rest } = validDashboard;
      return rest;
    })() },
  ];
  it.each(dashboardFixtures)("EvalDashboard: $label parses identically in both copies", ({ value }) => {
    expect(ClientEvalDashboard.safeParse(value).success).toBe(
      ServerEvalDashboard.safeParse(value).success,
    );
  });

  const validComparison = {
    old: validBatch,
    new: { ...validBatch, id: "b2", agent_version: 3 },
    old_config: null,
    new_config: null,
    comparable: false,
    incomparable_reason: "metrics_version_mismatch",
    delta: { recall: null, precision: null, citation_accuracy: null, cost_usd: 0.002 },
  };
  const comparisonFixtures: { label: string; value: unknown }[] = [
    { label: "valid, incomparable with null configs", value: validComparison },
    { label: "valid, comparable with numeric deltas", value: {
      ...validComparison,
      comparable: true,
      incomparable_reason: null,
      delta: { recall: 0.1, precision: 0.1, citation_accuracy: 0, cost_usd: 0.002 },
    } },
    { label: "comparable as a string", value: { ...validComparison, comparable: "false" } },
    { label: "missing old", value: (() => {
      const { old: _old, ...rest } = validComparison;
      return rest;
    })() },
    { label: "delta.recall as a string", value: {
      ...validComparison,
      delta: { ...validComparison.delta, recall: "0.1" },
    } },
  ];
  it.each(comparisonFixtures)("EvalRunComparison: $label parses identically in both copies", ({ value }) => {
    expect(ClientEvalRunComparison.safeParse(value).success).toBe(
      ServerEvalRunComparison.safeParse(value).success,
    );
  });

  const validAgent = {
    id: "agent-1",
    name: "Agent",
    description: "",
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "review carefully",
    enabled: true,
    version: 3,
  };
  const validPromoteResult = { agent: validAgent, version: 3, skills_not_restored: [] };
  const promoteResultFixtures: { label: string; value: unknown }[] = [
    { label: "valid, nothing unrestored", value: validPromoteResult },
    { label: "valid, two skills unrestored", value: { ...validPromoteResult, skills_not_restored: ["s1", "s2"] } },
    { label: "missing agent", value: (() => {
      const { agent: _agent, ...rest } = validPromoteResult;
      return rest;
    })() },
    { label: "version as a string", value: { ...validPromoteResult, version: "3" } },
    { label: "skills_not_restored holding a number", value: { ...validPromoteResult, skills_not_restored: [1] } },
  ];
  it.each(promoteResultFixtures)("EvalPromoteResult: $label parses identically in both copies", ({ value }) => {
    expect(ClientEvalPromoteResult.safeParse(value).success).toBe(
      ServerEvalPromoteResult.safeParse(value).success,
    );
  });

  /**
   * Negative control: `EvalRunRecord` is untouched by this spec. If a future
   * edit drifts the client's copy for an unrelated reason, this assertion —
   * not the two above — is what fails, proving the test exercises real
   * cross-copy agreement rather than two schemas that always agree.
   */
  it("negative control: the untouched EvalRunRecord still parses identically in both copies", () => {
    const validRun = {
      id: "r1",
      case_id: "c1",
      case_name: "case 1",
      ran_at: "2026-10-07T00:00:00.000Z",
      actual_output: {},
      pass: true,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      duration_ms: 500,
      cost_usd: 0.00001,
    };
    expect(ClientEvalRunRecord.safeParse(validRun).success).toBe(
      ServerEvalRunRecord.safeParse(validRun).success,
    );
    const invalidRun = { ...validRun, pass: "yes" };
    expect(ClientEvalRunRecord.safeParse(invalidRun).success).toBe(
      ServerEvalRunRecord.safeParse(invalidRun).success,
    );
  });
});
