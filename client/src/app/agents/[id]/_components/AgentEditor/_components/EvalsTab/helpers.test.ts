import { describe, it, expect } from "vitest";
import type { RunEvent } from "@devdigest/shared";
import { countCompletedCases } from "./helpers";

function resultEvent(over: Partial<RunEvent> = {}): RunEvent {
  return { runId: "batch-1", seq: 1, kind: "result", msg: "Case 1/3 x: PASS", t: "00:00:01", ...over };
}

function errorEvent(over: Partial<RunEvent> = {}): RunEvent {
  return { runId: "batch-1", seq: 1, kind: "error", msg: "Case 1/3 x failed: boom", t: "00:00:01", ...over };
}

describe("countCompletedCases", () => {
  it("counts result events carrying structured evalCase data", () => {
    const events: RunEvent[] = [
      resultEvent({ seq: 1, data: { evalCase: { index: 1, total: 3, pass: true } } }),
      resultEvent({ seq: 2, data: { evalCase: { index: 2, total: 3, pass: false } } }),
    ];
    expect(countCompletedCases(events)).toBe(2);
  });

  it("counts error events carrying structured evalCase data (a per-case provider exception)", () => {
    // eval-run-executor.ts's catch block publishes the per-case verdict as a
    // `kind: 'error'` event (run-logger.ts's `runLog.error`), not `result` —
    // only the zero-diff path uses `result`. Both carry the same shape.
    const events: RunEvent[] = [
      resultEvent({ seq: 1, data: { evalCase: { index: 1, total: 3, pass: true } } }),
      errorEvent({ seq: 2, data: { evalCase: { index: 2, total: 3, pass: false } } }),
      errorEvent({ seq: 3, data: { evalCase: { index: 3, total: 3, pass: false } } }),
    ];
    expect(countCompletedCases(events)).toBe(3);
  });

  it("does NOT count an error event with no structured evalCase field (e.g. a stream-level error)", () => {
    const events: RunEvent[] = [errorEvent({ data: undefined })];
    expect(countCompletedCases(events)).toBe(0);
  });

  it("does NOT count by matching the human-readable message alone — a reword must not break it", () => {
    const events: RunEvent[] = [
      // Same prose as a real per-case line, but with no structured field —
      // this must not be counted, proving the function reads `data`, not `msg`.
      resultEvent({ msg: "Case 1/3 renamed-agent-prose: PASS", data: undefined }),
    ];
    expect(countCompletedCases(events)).toBe(0);
  });

  it("does NOT count the batch's own terminal result event (no evalCase field)", () => {
    const events: RunEvent[] = [
      resultEvent({ seq: 1, data: { evalCase: { index: 1, total: 1, pass: true } } }),
      resultEvent({ seq: 2, msg: "Run complete", data: undefined }),
    ];
    expect(countCompletedCases(events)).toBe(1);
  });

  it("ignores non-result events even if they happen to carry an evalCase-shaped payload", () => {
    const events: RunEvent[] = [
      resultEvent({ kind: "info", data: { evalCase: { index: 1, total: 1, pass: true } } }),
    ];
    expect(countCompletedCases(events)).toBe(0);
  });

  it("zero events → zero", () => {
    expect(countCompletedCases([])).toBe(0);
  });
});
