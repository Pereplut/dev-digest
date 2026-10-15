import { describe, it, expect } from "vitest";
import {
  formatAgentEstimate,
  formatDurationHint,
  summariseEstimate,
} from "./multiAgentEstimate";

const a = (d: number | null | undefined, c: number | null | undefined) => ({
  est_duration_ms: d,
  est_cost_usd: c,
});

describe("summariseEstimate", () => {
  it("is the max duration and the summed cost", () => {
    expect(summariseEstimate([a(8200, 0.06), a(7400, 0.05), a(6900, 0.04)])).toEqual({
      duration_ms: 8200,
      cost_usd: expect.closeTo(0.15, 5),
    });
  });

  it("ignores an agent without history in both totals", () => {
    expect(summariseEstimate([a(1000, 0.01), a(null, 5), a(undefined, undefined)])).toEqual({
      duration_ms: 1000,
      cost_usd: 0.01,
    });
  });

  it("is null when no agent has history", () => {
    expect(summariseEstimate([a(null, null), a(undefined, 2)])).toBeNull();
    expect(summariseEstimate([])).toBeNull();
  });

  it("has a null cost when agents have a duration but no cost", () => {
    expect(summariseEstimate([a(1000, null)])).toEqual({ duration_ms: 1000, cost_usd: null });
  });
});

describe("formatting", () => {
  it("renders the picker hint and card text, null for no history", () => {
    expect(formatDurationHint(a(6400, 0.1))).toBe("~6s");
    expect(formatDurationHint(a(null, 0.1))).toBeNull();
    const usd = (n: number) => `USD${n}`;
    expect(formatAgentEstimate(a(8200, 0.06), usd)).toBe("8.2s · USD0.06");
    expect(formatAgentEstimate(a(8200, null), usd)).toBe("8.2s");
    expect(formatAgentEstimate(a(undefined, 1), usd)).toBeNull();
  });
});
