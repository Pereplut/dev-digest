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
} from "../../../server/src/vendor/shared/contracts/eval-ci";
import { EvalCase as ServerEvalCase } from "../../../server/src/vendor/shared/contracts/knowledge";

import {
  EvalBatchRecord as ClientEvalBatchRecord,
  EvalRunRecord as ClientEvalRunRecord,
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
  };

  const { agent_id: _agentId, ...batchMissingAgentId } = validBatch;

  const batchFixtures: { label: string; value: unknown }[] = [
    { label: "valid batch", value: validBatch },
    { label: "unknown status member", value: { ...validBatch, status: "paused" } },
    { label: "wrong type for cases_total", value: { ...validBatch, cases_total: "five" } },
    { label: "missing required field", value: batchMissingAgentId },
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
