import { describe, expect, it } from "vitest";
import { TABS, DEFAULT_TAB } from "./constants";
import { parseTab } from "./helpers";

describe("parseTab", () => {
  // The regression this file exists for: `?tab=evals` used to be rewritten to
  // "config" because the page kept its own hand-written tab allowlist, and
  // that list was never updated when the Evals tab shipped. Iterating TABS
  // means a fourth tab cannot reintroduce it.
  it.each(TABS.map((tb) => tb.key))("accepts the shipped tab %s", (key) => {
    expect(parseTab(key)).toBe(key);
  });

  it("falls back to the default for an unknown tab", () => {
    expect(parseTab("stats")).toBe(DEFAULT_TAB);
  });

  it("falls back to the default when ?tab= is absent", () => {
    expect(parseTab(null)).toBe(DEFAULT_TAB);
    expect(parseTab(undefined)).toBe(DEFAULT_TAB);
  });
});
