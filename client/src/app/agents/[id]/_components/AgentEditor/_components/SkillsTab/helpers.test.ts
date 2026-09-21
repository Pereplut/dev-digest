import { describe, it, expect } from "vitest";
import type { AgentSkill, Skill } from "@devdigest/shared";
import {
  countEnabled,
  filterRows,
  mergeSkillRows,
  moveSkill,
  sumTokens,
  toAgentSkills,
  toPayload,
  toggleSkill,
} from "./helpers";

const skill = (id: string, over: Partial<Skill> = {}): Skill => ({
  id,
  name: id,
  description: `${id} description`,
  type: "rubric",
  source: "manual",
  body: "body",
  enabled: true,
  version: 1,
  token_count: 100,
  ...over,
});

const link = (sk: Skill, order: number, enabled = true): AgentSkill => ({
  agent_id: "ag1",
  skill_id: sk.id,
  order,
  enabled,
  skill: sk,
});

const A = skill("alpha");
const B = skill("bravo", { token_count: 50 });
const C = skill("charlie", { enabled: false });
const Z = skill("zulu");

// Links deliberately out of array order: order is the source of truth.
const rows = () => mergeSkillRows([link(C, 1, true), link(B, 0, false)], [Z, A, B, C]);
const ids = (rs: { skill: Skill }[]) => rs.map((r) => r.skill.id);

describe("SkillsTab helpers", () => {
  it("merges linked skills in link order, then unlinked alphabetically", () => {
    const r = rows();
    expect(ids(r)).toEqual(["bravo", "charlie", "alpha", "zulu"]);
    expect(r.map((x) => [x.linked, x.enabled])).toEqual([
      [true, false],
      [true, true],
      [false, false],
      [false, false],
    ]);
  });

  it("toggles: a new link goes to the end of the linked group, an unchecked link keeps its place", () => {
    const linked = toggleSkill(rows(), "zulu", true);
    expect(toPayload(linked)).toEqual([
      { skill_id: "bravo", enabled: false },
      { skill_id: "charlie", enabled: true },
      { skill_id: "zulu", enabled: true },
    ]);
    expect(ids(linked)).toEqual(["bravo", "charlie", "zulu", "alpha"]);

    const unchecked = toggleSkill(linked, "charlie", false);
    expect(toPayload(unchecked)[1]).toEqual({ skill_id: "charlie", enabled: false });
    // unchecking an unlinked skill changes nothing
    expect(toPayload(toggleSkill(rows(), "alpha", false))).toEqual(toPayload(rows()));
  });

  it("moves only between linked rows", () => {
    expect(ids(moveSkill(rows(), "charlie", "bravo"))).toEqual(["charlie", "bravo", "alpha", "zulu"]);
    expect(ids(moveSkill(rows(), "alpha", "bravo"))).toEqual(ids(rows()));
    expect(ids(moveSkill(rows(), "bravo", "alpha"))).toEqual(ids(rows()));
  });

  it("counts and sums only skills that reach the prompt (checked AND globally enabled)", () => {
    const r = toggleSkill(toggleSkill(rows(), "bravo", true), "alpha", true);
    // bravo(50) + alpha(100) reach it; charlie is checked but globally off
    expect(countEnabled(r)).toBe(2);
    expect(sumTokens(r)).toBe(150);
    expect(countEnabled(rows())).toBe(0);
  });

  it("builds the optimistic cache value with a dense order", () => {
    expect(toAgentSkills("ag1", rows()).map((l) => [l.skill_id, l.order, l.enabled])).toEqual([
      ["bravo", 0, false],
      ["charlie", 1, true],
    ]);
  });

  it("filters by name or description, case-insensitively", () => {
    expect(ids(filterRows(rows(), "ZUL"))).toEqual(["zulu"]);
    expect(ids(filterRows(rows(), "alpha desc"))).toEqual(["alpha"]);
    expect(filterRows(rows(), "  ")).toHaveLength(4);
  });
});
