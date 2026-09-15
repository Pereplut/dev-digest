/**
 * findings-summary helpers — counting and grouping behind the PR list FINDINGS
 * column and the timeline chips: dismissed findings never count, summary
 * reviews are ignored, and the list popover sticks to the latest-round runs.
 */
import { describe, it, expect } from "vitest";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import {
  countBySeverity,
  isOpenFinding,
  lineRange,
  openFindingsByRun,
  roundFindings,
  sortBySeverity,
  totalFindings,
} from "./helpers";

function finding(o: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f",
    severity: "WARNING",
    category: "bug",
    title: "t",
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rv",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  } as FindingRecord;
}

function review(o: Partial<ReviewRecord>): ReviewRecord {
  return {
    id: "rv",
    pr_id: "pr-1",
    agent_id: "a1",
    run_id: "run-1",
    kind: "review",
    verdict: "comment",
    summary: null,
    score: 80,
    model: null,
    created_at: "2026-09-15T10:00:00Z",
    findings: [],
    ...o,
  } as ReviewRecord;
}

describe("countBySeverity / totalFindings", () => {
  it("tallies the three severities and ignores unknown ones", () => {
    const counts = countBySeverity([
      finding({ severity: "CRITICAL" }),
      finding({ severity: "WARNING" }),
      finding({ severity: "WARNING" }),
      finding({ severity: "INFO" as FindingRecord["severity"] }),
    ]);
    expect(counts).toEqual({ CRITICAL: 1, WARNING: 2, SUGGESTION: 0 });
    expect(totalFindings(counts)).toBe(3);
    expect(totalFindings(null)).toBe(0);
  });
});

describe("isOpenFinding", () => {
  it("dismissed findings are closed; accepted ones stay open", () => {
    expect(isOpenFinding(finding({ dismissed_at: "2026-09-15T10:00:00Z" }))).toBe(false);
    expect(isOpenFinding(finding({ accepted_at: "2026-09-15T10:00:00Z" }))).toBe(true);
  });
});

describe("sortBySeverity / lineRange", () => {
  it("orders CRITICAL → WARNING → SUGGESTION, stable within a severity", () => {
    const sorted = sortBySeverity([
      finding({ id: "s", severity: "SUGGESTION" }),
      finding({ id: "w1", severity: "WARNING" }),
      finding({ id: "c", severity: "CRITICAL" }),
      finding({ id: "w2", severity: "WARNING" }),
    ]);
    expect(sorted.map((f) => f.id)).toEqual(["c", "w1", "w2", "s"]);
  });

  it("formats a single line and a range", () => {
    expect(lineRange({ start_line: 12, end_line: 12 })).toBe("12");
    expect(lineRange({ start_line: 45, end_line: 52 })).toBe("45-52");
  });
});

describe("openFindingsByRun / roundFindings", () => {
  const reviews = [
    review({
      id: "rv1",
      run_id: "run-1",
      findings: [
        finding({ id: "open", severity: "WARNING" }),
        finding({ id: "dismissed", severity: "CRITICAL", dismissed_at: "2026-09-15T10:00:00Z" }),
      ],
    }),
    review({ id: "sum", run_id: "run-1", kind: "summary", findings: [finding({ id: "summary" })] }),
    review({ id: "rv2", run_id: "run-old", findings: [finding({ id: "old", severity: "CRITICAL" })] }),
    review({ id: "legacy", run_id: null, findings: [finding({ id: "legacy" })] }),
  ];

  it("maps each run to its review's open findings (summary and unlinked reviews ignored)", () => {
    const byRun = openFindingsByRun(reviews);
    expect(byRun.get("run-1")!.map((f) => f.id)).toEqual(["open"]);
    expect(byRun.get("run-old")!.map((f) => f.id)).toEqual(["old"]);
    expect(byRun.size).toBe(2);
  });

  it("keeps only the given round's runs", () => {
    expect(roundFindings(reviews, ["run-1"]).map((f) => f.id)).toEqual(["open"]);
    expect(roundFindings(reviews, ["run-1", "run-old"]).map((f) => f.id)).toEqual(["old", "open"]);
    expect(roundFindings(reviews, null)).toEqual([]);
  });
});
