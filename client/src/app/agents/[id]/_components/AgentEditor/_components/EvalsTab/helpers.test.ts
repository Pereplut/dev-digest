import { describe, it, expect } from "vitest";
import type { EvalTrendPoint, RunEvent } from "@devdigest/shared";
import { alertDeltaPoints, countCompletedCases, deltaColor, formatDeltaTile, plottable, toTrendSeries } from "./helpers";

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

function point(over: Partial<EvalTrendPoint> = {}): EvalTrendPoint {
  return {
    ran_at: "2026-10-01T00:00:00.000Z",
    recall: 0.5,
    precision: 0.5,
    citation_accuracy: 0.5,
    pass_rate: 0.5,
    cost_usd: 0.01,
    ...over,
  };
}

describe("toTrendSeries (AC-42, AC-43, AC-66)", () => {
  it("a five-point trend yields three equal-length, index-aligned series", () => {
    const trend = [0, 1, 2, 3, 4].map((i) =>
      point({ recall: i / 10, precision: i / 10 + 0.1, citation_accuracy: i / 10 + 0.2 }),
    );
    const { series, dropped } = toTrendSeries(trend);
    expect(dropped).toBe(0);
    expect(series).toHaveLength(3);
    for (const s of series) expect(s.data).toHaveLength(5);
  });

  it("drops a point with ANY null metric from all three series, keeping index alignment", () => {
    const trend = [
      point({ recall: 0, precision: 0.1, citation_accuracy: 0.2 }),
      point({ recall: 0.3, precision: 0.4, citation_accuracy: 0.5 }),
      point({ citation_accuracy: null }), // dropped — middle point
      point({ recall: 0.6, precision: 0.7, citation_accuracy: 0.8 }),
      point({ recall: 0.9, precision: 1.0, citation_accuracy: 0.95 }),
    ];
    const { series, dropped } = toTrendSeries(trend);
    expect(dropped).toBe(1);
    for (const s of series) expect(s.data).toHaveLength(4);
    // The surviving 3rd element (index 2) must be the FOURTH original point's
    // value in every series — not just the recall one — proving the drop
    // happened on all three series, not only the one that was null.
    const recall = series.find((s) => s.name === "recall")!;
    const precision = series.find((s) => s.name === "precision")!;
    const citation = series.find((s) => s.name === "citationAccuracy")!;
    expect(recall.data[2]).toBe(0.6);
    expect(precision.data[2]).toBe(0.7);
    expect(citation.data[2]).toBe(0.8);
  });

  it("every element of every series satisfies Number.isFinite — no null/undefined/substituted 0", () => {
    const trend = [
      point({ recall: 0, precision: null, citation_accuracy: 0 }),
      point({ recall: 0.1, precision: 0.1, citation_accuracy: 0.1 }),
    ];
    const { series } = toTrendSeries(trend);
    for (const s of series) {
      expect(s.data).toHaveLength(1);
      for (const v of s.data) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("plottable (AC-44)", () => {
  it("fewer than two points is not plottable", () => {
    expect(plottable([{ name: "recall", color: "x", data: [] }])).toBe(false);
    expect(plottable([{ name: "recall", color: "x", data: [0.5] }])).toBe(false);
  });

  it("two or more points is plottable", () => {
    expect(plottable([{ name: "recall", color: "x", data: [0.5, 0.6] }])).toBe(true);
  });
});

describe("formatDeltaTile (AC-39, AC-40)", () => {
  it.each([
    [0.021, "+2.1pt"],
    [-0.02, "-2.0pt"],
    [0, "0.0pt"],
  ])("%s -> %s", (value, expected) => {
    expect(formatDeltaTile(value, "—")).toBe(expected);
  });

  it("null renders the placeholder with no sign and no direction word", () => {
    expect(formatDeltaTile(null, "—")).toBe("—");
    expect(formatDeltaTile(undefined, "—")).toBe("—");
  });
});

describe("deltaColor", () => {
  it("positive is ok, negative is crit, zero and null are muted", () => {
    expect(deltaColor(0.02)).toBe("var(--ok)");
    expect(deltaColor(-0.02)).toBe("var(--crit)");
    expect(deltaColor(0)).toBe("var(--text-muted)");
    expect(deltaColor(null)).toBe("var(--text-muted)");
  });
});

describe("alertDeltaPoints", () => {
  it("reads the delta the code names, as unsigned percentage points", () => {
    const delta = { recall: -0.02, precision: -0.031, citation_accuracy: null };
    expect(alertDeltaPoints("recall_drop", delta)).toBe("2.0");
    expect(alertDeltaPoints("precision_drop", delta)).toBe("3.1");
    expect(alertDeltaPoints("citation_drop", delta)).toBe("0.0");
  });
});
