import { describe, it, expect } from "vitest";
import { NAV, resolveHref } from "@/components/ui-client";

/** Spec 0017 (Onboarding Generator), AC-44: the sidebar carries an
    "Onboarding Tour" item in the WORKSPACE group, whose href template
    resolves against the active repo id the same way every other repo-scoped
    nav item does. No AppFrame render is needed for this: the item's data and
    `resolveHref`'s substitution are what AC-44 specifies. */
describe("NAV — onboarding tour item", () => {
  const workspace = NAV.find((g) => g.section === "WORKSPACE");
  const item = workspace?.items.find((i) => i.key === "onboarding-tour");

  it("is registered in the WORKSPACE group with the tour href template", () => {
    expect(item).toBeDefined();
    expect(item?.label).toBe("Onboarding Tour");
    expect(item?.href).toBe("/repos/:repoId/tour");
  });

  it("resolves against the active repo id", () => {
    expect(resolveHref(item!.href, "r1")).toBe("/repos/r1/tour");
  });

  it("falls back to the `_` placeholder with no active repo", () => {
    expect(resolveHref(item!.href, null)).toBe("/repos/_/tour");
  });
});

/** Spec 0021, AC-28: a GLOBAL section holds the Multi-Agent Review item. */
describe("NAV — multi-agent review item", () => {
  const item = NAV.find((g) => g.section === "GLOBAL")?.items.find((i) => i.key === "multi-agent");

  it("is registered in the GLOBAL group and links to /multi-agent-review", () => {
    expect(item?.label).toBe("Multi-Agent Review");
    expect(item?.href).toBe("/multi-agent-review");
    expect(resolveHref(item!.href, "r1")).toBe("/multi-agent-review");
  });

  it("registers no g-shortcut", () => {
    expect(item?.gKey).toBeUndefined();
  });
});
