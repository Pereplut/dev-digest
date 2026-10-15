import { describe, it, expect } from "vitest";
import { NO_VALUE, formatDuration, formatPr, formatTimestamp } from "./helpers";

describe("CiRunsView helpers", () => {
  it("formatDuration: placeholder for null, undefined, negative and non-finite", () => {
    for (const bad of [null, undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatDuration(bad)).toBe(NO_VALUE);
    }
  });

  it("formatDuration: sub-second in ms, seconds under a minute, whole minutes bare, otherwise 'Xm Ys'", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(850)).toBe("850ms");
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(12_400)).toBe("12s");
    expect(formatDuration(59_000)).toBe("59s");
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(120_000)).toBe("2m");
    expect(formatDuration(83_000)).toBe("1m 23s");
  });

  it("formatDuration: rounding that reaches 60s rolls over to a minute", () => {
    // 59_500ms rounds to 60 seconds, which must read "1m", not "60s".
    expect(formatDuration(59_500)).toBe("1m");
  });

  it("formatTimestamp and formatPr give the placeholder for missing values", () => {
    expect(formatTimestamp(null)).toBe(NO_VALUE);
    expect(formatTimestamp("nope")).toBe(NO_VALUE);
    expect(formatTimestamp("2026-10-01T12:00:00.000Z")).toBe(new Date("2026-10-01T12:00:00.000Z").toLocaleString());
    expect(formatPr(null)).toBe(NO_VALUE);
    expect(formatPr(7)).toBe("#7");
  });
});
