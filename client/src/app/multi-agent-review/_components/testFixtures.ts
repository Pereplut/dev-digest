/* Builders for the multi-agent component tests (imported only by *.test.tsx). */
import type { AgentColumn, Conflict, FindingRecord, MultiAgentRun } from "@devdigest/shared";

export function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "WARNING",
    category: "bug",
    title: "Retry-After header omitted",
    file: "src/mw/ratelimit.ts",
    start_line: 52,
    end_line: 52,
    rationale: "A rationale.",
    suggestion: null,
    confidence: 0.8,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rev1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

export function column(over: Partial<AgentColumn> = {}): AgentColumn {
  return {
    run_id: "run-a",
    agent_id: "a1",
    agent_name: "Security",
    provider: "openrouter",
    model: "m",
    status: "done",
    error: null,
    verdict: "request_changes",
    score: 38,
    summary: "Two critical exposures.",
    duration_ms: 8200,
    cost_usd: 0.06,
    findings: [finding()],
    ...over,
  } as AgentColumn;
}

export function run(over: Partial<MultiAgentRun> = {}): MultiAgentRun {
  return {
    id: "m1",
    pr_id: "pr1",
    pr_number: 482,
    pr_title: "Add rate limiting",
    ran_at: "2026-10-15T00:00:00Z",
    agent_count: 2,
    total_duration_ms: 8200,
    total_cost_usd: 0.2,
    columns: [column(), column({ run_id: "run-b", agent_id: "a2", agent_name: "Performance", findings: [] })],
    conflicts: [],
    ...over,
  };
}

export function conflict(over: Partial<Conflict> = {}): Conflict {
  return {
    file: "src/mw/ratelimit.ts",
    start_line: 52,
    end_line: 52,
    title: "429 response shape",
    divergent: true,
    takes: [
      { run_id: "run-a", agent_id: "a1", persona: null, verdict: "WARNING", note: "Needs Retry-After.", finding_ids: ["f1"] },
      { run_id: "run-b", agent_id: "a2", persona: null, verdict: "ignored", note: "", finding_ids: [] },
    ],
    ...over,
  };
}
