import { describe, it, expect } from "vitest";
import {
  keyForFinding,
  findingKeyForLine,
  findingsForFile,
  normalizeFindingPath,
  partitionFindings,
  worstSeverity,
  type DiffFindingLike,
} from "./findings";
import type { Line } from "./helpers";

/**
 * Pure placement logic for review findings in the diff — which finding shows on
 * which row, and which ones would vanish if we let them.
 *
 * Fixtures are full objects, not partial casts, for the reason comments.test.ts
 * records: a cast lets a test encode a shape the domain types forbid.
 */

function finding(over: Partial<DiffFindingLike> = {}): DiffFindingLike {
  return { id: "f1", file: "src/a.ts", start_line: 10, severity: "WARNING", ...over };
}

function line(over: Partial<Line> = {}): Line {
  return { kind: "ctx", text: "x", oldNo: 1, newNo: 1, ...over };
}

describe("normalizeFindingPath", () => {
  it("strips a leading ./, / and diff a//b/ prefix", () => {
    expect(normalizeFindingPath("./src/a.ts")).toBe("src/a.ts");
    expect(normalizeFindingPath("/src/a.ts")).toBe("src/a.ts");
    expect(normalizeFindingPath("b/src/a.ts")).toBe("src/a.ts");
  });

  it("leaves an already repo-relative path alone", () => {
    expect(normalizeFindingPath("src/a.ts")).toBe("src/a.ts");
  });
});

describe("keyForFinding", () => {
  it("anchors to the NEW line, since start_line is a post-image line", () => {
    expect(keyForFinding(finding({ start_line: 28 }))).toBe("RIGHT:28");
  });
});

describe("findingKeyForLine", () => {
  it("keys added and context lines by their new number", () => {
    expect(findingKeyForLine(line({ kind: "add", newNo: 5 }))).toBe("RIGHT:5");
    expect(findingKeyForLine(line({ kind: "ctx", newNo: 5 }))).toBe("RIGHT:5");
  });

  it("refuses deleted and hunk lines — they have no new line to anchor to", () => {
    expect(findingKeyForLine(line({ kind: "del", newNo: undefined }))).toBeNull();
    expect(findingKeyForLine(line({ kind: "hunk" }))).toBeNull();
  });
});

describe("findingsForFile", () => {
  it("matches across path spellings", () => {
    const list = [finding({ id: "a", file: "./src/a.ts" }), finding({ id: "b", file: "src/b.ts" })];
    expect(findingsForFile(list, "src/a.ts").map((f) => f.id)).toEqual(["a"]);
  });

  it("returns nothing for an undefined or empty list", () => {
    expect(findingsForFile(undefined, "src/a.ts")).toEqual([]);
    expect(findingsForFile([], "src/a.ts")).toEqual([]);
  });
});

describe("partitionFindings", () => {
  it("matches a finding whose line is rendered", () => {
    const f = finding({ start_line: 10 });
    const { matched, offPatch } = partitionFindings([f], new Set(["RIGHT:10"]));
    expect(matched.get("RIGHT:10")).toEqual([f]);
    expect(offPatch).toEqual([]);
  });

  it("keeps a finding outside the patch instead of dropping it", () => {
    const f = finding({ start_line: 999 });
    const { matched, offPatch } = partitionFindings([f], new Set(["RIGHT:10"]));
    expect(matched.size).toBe(0);
    expect(offPatch).toEqual([f]);
  });

  it("puts two findings on one line in the same bucket", () => {
    const a = finding({ id: "a" });
    const b = finding({ id: "b" });
    const { matched } = partitionFindings([a, b], new Set(["RIGHT:10"]));
    expect(matched.get("RIGHT:10")).toEqual([a, b]);
  });
});

describe("worstSeverity", () => {
  it("picks the most severe on the line, whatever the order", () => {
    expect(
      worstSeverity([finding({ severity: "SUGGESTION" }), finding({ severity: "CRITICAL" })]),
    ).toBe("CRITICAL");
    expect(
      worstSeverity([finding({ severity: "WARNING" }), finding({ severity: "SUGGESTION" })]),
    ).toBe("WARNING");
  });

  it("is null for no findings", () => {
    expect(worstSeverity([])).toBeNull();
  });
});
