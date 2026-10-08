import { describe, it, expect } from "vitest";
import { toDiffRows } from "./text-diff";

describe("toDiffRows", () => {
  it("identical strings produce only 'same' rows", () => {
    const rows = toDiffRows("a\nb\nc", "a\nb\nc");
    expect(rows.every((r) => r.kind === "same")).toBe(true);
    expect(rows.map((r) => r.text)).toEqual(["a", "b", "c"]);
  });

  it("one line appended yields one 'add' and no 'del'", () => {
    const rows = toDiffRows("a\nb\n", "a\nb\nc\n");
    expect(rows.filter((r) => r.kind === "del")).toHaveLength(0);
    expect(rows.filter((r) => r.kind === "add")).toEqual([{ kind: "add", text: "c" }]);
  });

  it("one line deleted yields one 'del'", () => {
    const rows = toDiffRows("a\nb\nc", "a\nc");
    expect(rows.filter((r) => r.kind === "del")).toEqual([{ kind: "del", text: "b" }]);
    expect(rows.filter((r) => r.kind === "add")).toHaveLength(0);
  });

  it("an edited line yields one 'add' and one 'del'", () => {
    const rows = toDiffRows("a\nb\nc", "a\nB\nc");
    expect(rows.filter((r) => r.kind === "del")).toEqual([{ kind: "del", text: "b" }]);
    expect(rows.filter((r) => r.kind === "add")).toEqual([{ kind: "add", text: "B" }]);
  });

  it("an empty older string makes every row an 'add'", () => {
    const rows = toDiffRows("", "a\nb");
    expect(rows.every((r) => r.kind === "add")).toBe(true);
  });

  /**
   * A trailing-newline-only difference does NOT produce "no spurious rows" —
   * `diffLines` tokenizes a trailing `"b\n"` and a tail-of-string `"b"` as two
   * different line tokens, so it reports a del+add pair for that one line
   * even though its TEXT is identical on both sides. `VersionsTab/helpers.ts`'s
   * own old comment ("the helper strips one trailing `\n` per part … no
   * spurious rows") was never exercised by a test and is wrong — recorded
   * here as the behaviour this helper actually has, not the one the move's
   * source comment claimed.
   */
  it("a trailing-newline-only difference reports a del+add pair for that line (documented quirk, not 'no rows')", () => {
    const rows = toDiffRows("a\nb\n", "a\nb");
    expect(rows).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "b" },
    ]);
  });
});
