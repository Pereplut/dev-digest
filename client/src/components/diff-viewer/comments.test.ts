import { describe, it, expect } from "vitest";
import {
  lineKey,
  buildThreads,
  keysForLine,
  commentTargetFor,
  partitionThreads,
  type CommentThread,
} from "./comments";
import type { PrReviewComment } from "../../lib/types";
import type { Line } from "./helpers";

/**
 * Pure thread-partitioning logic for inline PR comments. No renderer, no fetch
 * — these are the functions that decide which comment shows on which diff row,
 * and whether a comment is silently dropped as "outdated".
 *
 * The fixtures below build FULL contract objects rather than casting partials:
 * an earlier version used `as PrReviewComment` and invented `null` line numbers
 * that `Line` (oldNo?/newNo? — optional, never null) cannot produce, so the
 * tests encoded a shape the domain types forbid.
 */

function comment(over: Partial<PrReviewComment> = {}): PrReviewComment {
  return {
    id: 1,
    path: "src/a.ts",
    line: 10,
    original_line: 10,
    side: "RIGHT",
    body: "b",
    user: "u",
    created_at: "2026-01-01T00:00:00Z",
    html_url: "https://example.test",
    in_reply_to_id: null,
    is_outdated: false,
    ...over,
  };
}

function line(over: Partial<Line> = {}): Line {
  return { kind: "ctx", text: "x", oldNo: 1, newNo: 1, ...over };
}

describe("lineKey", () => {
  it("builds `${side}:${line}`", () => {
    expect(lineKey("RIGHT", 12)).toBe("RIGHT:12");
    expect(lineKey("LEFT", 3)).toBe("LEFT:3");
  });

  it("returns null for a missing line, so callers cannot key on it", () => {
    expect(lineKey("RIGHT", null)).toBeNull();
    expect(lineKey("RIGHT", undefined)).toBeNull();
  });

  it("treats line 0 as a real line, not as absent", () => {
    // `== null` rather than falsy — line 0 must still produce a key.
    expect(lineKey("RIGHT", 0)).toBe("RIGHT:0");
  });
});

describe("buildThreads", () => {
  it("groups replies under their root and orders them oldest-first", () => {
    const threads = buildThreads([
      comment({ id: 2, in_reply_to_id: 1, created_at: "2026-01-02T00:00:00Z" }),
      comment({ id: 1, created_at: "2026-01-01T00:00:00Z" }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.rootId).toBe(1);
    expect(threads[0]!.comments.map((c) => c.id)).toEqual([1, 2]);
  });

  it("keeps separate roots as separate threads", () => {
    const threads = buildThreads([comment({ id: 1 }), comment({ id: 5 })]);
    expect(threads.map((t) => t.rootId).sort()).toEqual([1, 5]);
  });

  it("takes line/side from the ROOT comment, not from a reply", () => {
    const threads = buildThreads([
      comment({ id: 1, line: 10, side: "RIGHT", created_at: "2026-01-01T00:00:00Z" }),
      comment({ id: 2, in_reply_to_id: 1, line: 99, side: "LEFT", created_at: "2026-01-02T00:00:00Z" }),
    ]);
    expect(threads[0]!.line).toBe(10);
    expect(threads[0]!.side).toBe("RIGHT");
  });

  it("marks a thread outdated when the root has no line", () => {
    const threads = buildThreads([comment({ id: 1, line: null })]);
    expect(threads[0]!.isOutdated).toBe(true);
  });

  it("survives a reply whose root is missing (falls back to the earliest)", () => {
    // GitHub can return a reply whose root is outside the fetched page.
    const threads = buildThreads([comment({ id: 2, in_reply_to_id: 77 })]);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.comments.map((c) => c.id)).toEqual([2]);
  });

  it("returns nothing for no comments", () => {
    expect(buildThreads([])).toEqual([]);
  });
});

describe("keysForLine", () => {
  it("context lines can host both sides", () => {
    expect(keysForLine(line({ kind: "ctx", oldNo: 4, newNo: 9 }))).toEqual(["RIGHT:9", "LEFT:4"]);
  });

  it("added lines are RIGHT-only", () => {
    expect(keysForLine(line({ kind: "add", oldNo: undefined, newNo: 9 }))).toEqual(["RIGHT:9"]);
  });

  it("deleted lines are LEFT-only", () => {
    expect(keysForLine(line({ kind: "del", oldNo: 4, newNo: undefined }))).toEqual(["LEFT:4"]);
  });

  it("drops sides whose line number is absent", () => {
    expect(keysForLine(line({ kind: "ctx", oldNo: undefined, newNo: undefined }))).toEqual([]);
  });
});

describe("commentTargetFor", () => {
  it("prefers the new side for added and context lines", () => {
    expect(commentTargetFor(line({ kind: "add", newNo: 12 }))).toEqual({ line: 12, side: "RIGHT" });
    expect(commentTargetFor(line({ kind: "ctx", newNo: 12 }))).toEqual({ line: 12, side: "RIGHT" });
  });

  it("uses the old side for deletions", () => {
    expect(commentTargetFor(line({ kind: "del", oldNo: 7, newNo: undefined }))).toEqual({
      line: 7,
      side: "LEFT",
    });
  });

  it("returns null when there is nothing to anchor to", () => {
    expect(commentTargetFor(line({ kind: "add", newNo: undefined }))).toBeNull();
    expect(commentTargetFor(line({ kind: "del", oldNo: undefined, newNo: undefined }))).toBeNull();
  });
});

describe("partitionThreads", () => {
  const thread = (over: Partial<CommentThread> = {}): CommentThread => ({
    rootId: 1,
    comments: [],
    line: 10,
    side: "RIGHT",
    isOutdated: false,
    ...over,
  });

  it("matches a thread to a rendered key", () => {
    const { matched, outdated } = partitionThreads([thread()], new Set(["RIGHT:10"]));
    expect(matched.get("RIGHT:10")).toHaveLength(1);
    expect(outdated).toEqual([]);
  });

  it("collects several threads on the same line", () => {
    const { matched } = partitionThreads(
      [thread({ rootId: 1 }), thread({ rootId: 2 })],
      new Set(["RIGHT:10"]),
    );
    expect(matched.get("RIGHT:10")).toHaveLength(2);
  });

  it("does NOT silently drop a thread whose line is not rendered", () => {
    // The whole point of the outdated bucket: the UI surfaces these separately.
    const { matched, outdated } = partitionThreads([thread({ line: 999 })], new Set(["RIGHT:10"]));
    expect(matched.size).toBe(0);
    expect(outdated).toHaveLength(1);
  });

  it("treats a null-line thread as outdated", () => {
    const { outdated } = partitionThreads(
      [thread({ line: null, isOutdated: true })],
      new Set(["RIGHT:10"]),
    );
    expect(outdated).toHaveLength(1);
  });

  it("keys on side as well as line, so LEFT:10 does not match RIGHT:10", () => {
    const { matched, outdated } = partitionThreads([thread({ side: "LEFT" })], new Set(["RIGHT:10"]));
    expect(matched.size).toBe(0);
    expect(outdated).toHaveLength(1);
  });
});
