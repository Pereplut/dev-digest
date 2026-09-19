import { describe, it, expect } from "vitest";
import type { RunTrace } from "@devdigest/shared";
import { slotTokens, splitSkillsBlock } from "./helpers";

const BLOCK = "## Skills\n### Skill: a\nbody a\n\n### Skill: b\nbody b";
const used = [
  { id: "1", name: "a", version: 2, tokens: 5 },
  { id: null, name: "b", version: 1, tokens: 7 },
];

describe("RunTraceDrawer helpers", () => {
  it("splits the skills block per skills_used entry, in order", () => {
    expect(splitSkillsBlock(BLOCK, used)).toEqual([
      { name: "a", version: 2, tokens: 5, text: "### Skill: a\nbody a" },
      { name: "b", version: 1, tokens: 7, text: "### Skill: b\nbody b" },
    ]);
  });

  it("falls back (null) for old traces or a block that disagrees with skills_used", () => {
    expect(splitSkillsBlock(BLOCK, undefined)).toBeNull();
    expect(splitSkillsBlock(BLOCK, [])).toBeNull();
    expect(splitSkillsBlock(BLOCK, used.slice(0, 1))).toBeNull();
    expect(splitSkillsBlock(BLOCK, [used[1]!, used[0]!])).toBeNull();
  });

  it("reads slot tokens defensively", () => {
    const trace = { prompt_tokens: { system: 3 } } as unknown as RunTrace;
    expect(slotTokens(trace, "system")).toBe(3);
    expect(slotTokens(trace, "user")).toBeNull();
    expect(slotTokens({} as RunTrace, "system")).toBeNull();
  });
});
