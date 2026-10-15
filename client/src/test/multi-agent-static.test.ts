import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Spec 0021 static guards: one RunTraceDrawer implementation (AC-38) and no raw
    HTML rendering anywhere under the multi-agent route (AC-42). */
const SRC = join(__dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("multi-agent static guards", () => {
  it("has exactly one RunTraceDrawer.tsx under client/src, in the shared components", () => {
    const hits = walk(SRC).filter((p) => p.endsWith("RunTraceDrawer.tsx"));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain(join("components", "run-trace-drawer"));
  });

  it("never uses dangerouslySetInnerHTML under app/multi-agent-review", () => {
    const files = walk(join(SRC, "app", "multi-agent-review")).filter((p) => /\.tsx?$/.test(p));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((p) => readFileSync(p, "utf8").includes("dangerouslySetInnerHTML"));
    expect(offenders).toEqual([]);
  });
});
