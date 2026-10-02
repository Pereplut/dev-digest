import { describe, it, expect } from "vitest";
import {
  computeAge,
  droppedTotal,
  isBlockingReason,
  isReindexableReason,
  repoShortName,
  showsStatus,
} from "./helpers";

describe("computeAge", () => {
  const now = Date.parse("2026-10-01T12:00:00.000Z");

  it("buckets a two-hour-old timestamp as hours", () => {
    expect(computeAge("2026-10-01T10:00:00.000Z", now)).toEqual({ unit: "hours", count: 2 });
  });

  it("buckets a two-day-old timestamp as days", () => {
    expect(computeAge("2026-09-29T12:00:00.000Z", now)).toEqual({ unit: "days", count: 2 });
  });

  it("clamps a future timestamp (clock skew) to just now, not a negative interval", () => {
    expect(computeAge("2026-10-01T12:00:30.000Z", now)).toEqual({ unit: "justNow", count: 0 });
  });

  it("buckets anything under a minute as just now", () => {
    expect(computeAge("2026-10-01T11:59:31.000Z", now)).toEqual({ unit: "justNow", count: 0 });
  });
});

describe("repoShortName", () => {
  it("drops the owner segment (AC-78)", () => {
    expect(repoShortName("acme/payments-api")).toBe("payments-api");
  });

  it("returns the whole string when there is no slash", () => {
    expect(repoShortName("payments-api")).toBe("payments-api");
  });
});

describe("droppedTotal", () => {
  it("sums dropped_refs across all sections", () => {
    const sections = [{ dropped_refs: 2 }, { dropped_refs: 0 }, { dropped_refs: 1 }] as never;
    expect(droppedTotal(sections)).toBe(3);
  });
});

describe("isBlockingReason / isReindexableReason", () => {
  it("blocks regenerate on the four precondition reasons, not on no_source_files or generation_failed", () => {
    expect(isBlockingReason("flag_off")).toBe(true);
    expect(isBlockingReason("no_clone")).toBe(true);
    expect(isBlockingReason("not_indexed")).toBe(true);
    expect(isBlockingReason("index_incomplete")).toBe(true);
    expect(isBlockingReason("no_source_files")).toBe(false);
    expect(isBlockingReason("generation_failed")).toBe(false);
    expect(isBlockingReason(null)).toBe(false);
  });

  it("shows Re-index only for not_indexed and index_incomplete", () => {
    expect(isReindexableReason("not_indexed")).toBe(true);
    expect(isReindexableReason("index_incomplete")).toBe(true);
    expect(isReindexableReason("no_source_files")).toBe(false);
    expect(isReindexableReason("flag_off")).toBe(false);
    expect(isReindexableReason("no_clone")).toBe(false);
    expect(isReindexableReason(null)).toBe(false);
  });
});

describe("showsStatus", () => {
  it("renders for anything but done", () => {
    expect(showsStatus("not_generated", 0)).toBe(true);
    expect(showsStatus("running", 0)).toBe(true);
    expect(showsStatus("partial", 0)).toBe(true);
    expect(showsStatus("failed", 0)).toBe(true);
  });

  it("hides on a clean done tour, shows on a done tour with drops (ANSWERED 2)", () => {
    expect(showsStatus("done", 0)).toBe(false);
    expect(showsStatus("done", 1)).toBe(true);
  });
});
