import { describe, it, expect } from "vitest";
import type { PrFile, SmartDiff } from "@/lib/types";
import type { DiffFindingLike } from "@/components/diff-viewer";
import { annotationToggle, filesWithFindings, orderedGroups } from "./helpers";

/**
 * The join between the server's grouping and the files the page holds. These two
 * lists come from different sources (GitHub live vs. the persisted copy), so the
 * mismatch cases are the point of this file, not an edge case.
 */

function file(path: string): PrFile {
  return { path, additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+x" };
}

function smart(groups: SmartDiff["groups"]): SmartDiff {
  return { groups, split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] } };
}

function grouped(role: SmartDiff["groups"][number]["role"], paths: string[]) {
  return {
    role,
    files: paths.map((path) => ({ path, additions: 1, deletions: 0, finding_lines: [] })),
  };
}

describe("orderedGroups", () => {
  it("renders groups in the order the server sent them", () => {
    const files = [file("README.md"), file("src/a.ts"), file("src/a.test.ts")];
    const { groups } = orderedGroups(
      files,
      smart([
        grouped("core", ["src/a.ts"]),
        grouped("tests", ["src/a.test.ts"]),
        grouped("docs", ["README.md"]),
      ]),
    );
    expect(groups.map((g) => g.role)).toEqual(["core", "tests", "docs"]);
  });

  it("preserves the server's order within a group", () => {
    const { groups } = orderedGroups(
      [file("src/a.ts"), file("src/z.ts")],
      smart([grouped("core", ["src/z.ts", "src/a.ts"])]),
    );
    expect(groups[0]!.files.map((f) => f.path)).toEqual(["src/z.ts", "src/a.ts"]);
  });

  it("skips a grouped path the page has no file for — there is no patch to show", () => {
    const { groups } = orderedGroups(
      [file("src/a.ts")],
      smart([grouped("core", ["src/a.ts", "src/vanished.ts"])]),
    );
    expect(groups[0]!.files.map((f) => f.path)).toEqual(["src/a.ts"]);
  });

  it("drops a group left with no files at all", () => {
    const { groups } = orderedGroups(
      [file("src/a.ts")],
      smart([grouped("core", ["src/a.ts"]), grouped("docs", ["gone.md"])]),
    );
    expect(groups.map((g) => g.role)).toEqual(["core"]);
  });

  it("returns a file no group claimed as a leftover instead of dropping it", () => {
    const { groups, leftovers } = orderedGroups(
      [file("src/a.ts"), file("src/new.ts")],
      smart([grouped("core", ["src/a.ts"])]),
    );
    expect(groups[0]!.files.map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(leftovers.map((f) => f.path)).toEqual(["src/new.ts"]);
  });

  it("groups nothing when the route gave nothing back", () => {
    expect(orderedGroups([file("src/a.ts")], undefined)).toEqual({ groups: [], leftovers: [] });
    expect(orderedGroups([file("src/a.ts")], smart([]))).toEqual({ groups: [], leftovers: [] });
  });
});

describe("annotationToggle", () => {
  it("talks about comments only until a review exists", () => {
    expect(annotationToggle(3, 0, false)).toEqual({ key: "diff.showComments", count: 3 });
    expect(annotationToggle(3, 0, true)).toEqual({ key: "diff.hideComments", count: 3 });
  });

  it("covers both kinds, and both counts, once there are findings", () => {
    expect(annotationToggle(3, 2, false)).toEqual({ key: "diff.showAnnotations", count: 5 });
    expect(annotationToggle(3, 2, true)).toEqual({ key: "diff.hideAnnotations", count: 5 });
  });

  it("counts findings alone when the PR has no comments", () => {
    expect(annotationToggle(0, 2, true)).toEqual({ key: "diff.hideAnnotations", count: 2 });
  });
});

describe("filesWithFindings", () => {
  const findings: DiffFindingLike[] = [
    { id: "1", file: "src/a.ts", start_line: 1, severity: "CRITICAL" },
    { id: "2", file: "src/a.ts", start_line: 2, severity: "WARNING" },
    { id: "3", file: "src/a.ts", start_line: 3, severity: "WARNING" },
    { id: "4", file: "src/b.ts", start_line: 1, severity: "SUGGESTION" },
    { id: "5", file: "src/b.ts", start_line: 2, severity: "SUGGESTION" },
  ];

  it("counts FILES, not findings — five findings over two files is 2", () => {
    expect(filesWithFindings([file("src/a.ts"), file("src/b.ts"), file("src/c.ts")], findings)).toBe(
      2,
    );
  });

  it("is zero before any review", () => {
    expect(filesWithFindings([file("src/a.ts")], [])).toBe(0);
  });

  it("matches a finding whose path is spelled ./", () => {
    expect(
      filesWithFindings([file("src/a.ts")], [
        { id: "1", file: "./src/a.ts", start_line: 1, severity: "WARNING" },
      ]),
    ).toBe(1);
  });
});
