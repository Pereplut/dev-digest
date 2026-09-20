import { describe, it, expect } from "vitest";
import { makeCandidate, makeScan } from "../../_lib/test-utils";
import { acceptedIds, countAccepted, isRunning, partition, relativeTime } from "./helpers";

describe("partition", () => {
  it("keeps accepted and undecided visible, hides rejected", () => {
    const rows = [
      makeCandidate({ id: "a", status: "pending" }),
      makeCandidate({ id: "b", status: "accepted" }),
      makeCandidate({ id: "c", status: "rejected" }),
    ];
    const { visible, rejected } = partition(rows);
    expect(visible.map((c) => c.id)).toEqual(["a", "b"]);
    expect(rejected.map((c) => c.id)).toEqual(["c"]);
  });
});

describe("countAccepted / acceptedIds", () => {
  it("counts and lists only accepted rows", () => {
    const rows = [
      makeCandidate({ id: "a", status: "accepted" }),
      makeCandidate({ id: "b", status: "accepted" }),
      makeCandidate({ id: "c", status: "pending" }),
    ];
    expect(countAccepted(rows)).toBe(2);
    expect(acceptedIds(rows)).toEqual(["a", "b"]);
  });

  it("is zero for an empty list", () => {
    expect(countAccepted([])).toBe(0);
    expect(acceptedIds([])).toEqual([]);
  });
});

describe("isRunning", () => {
  it("is the polling condition", () => {
    expect(isRunning(makeScan({ status: "running" }))).toBe(true);
    expect(isRunning(makeScan({ status: "done" }))).toBe(false);
    expect(isRunning(makeScan({ status: "failed" }))).toBe(false);
    expect(isRunning(null)).toBe(false);
    expect(isRunning(undefined)).toBe(false);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-09-20T12:00:00.000Z");

  it.each([
    ["2026-09-20T11:59:30.000Z", "just now"],
    ["2026-09-20T11:45:00.000Z", "15m ago"],
    ["2026-09-20T11:00:00.000Z", "1h ago"],
    ["2026-09-18T12:00:00.000Z", "2d ago"],
  ])("%s → %s", (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });

  it("returns null for missing or unparseable input", () => {
    expect(relativeTime(null, now)).toBeNull();
    expect(relativeTime(undefined, now)).toBeNull();
    expect(relativeTime("not a date", now)).toBeNull();
  });
});
