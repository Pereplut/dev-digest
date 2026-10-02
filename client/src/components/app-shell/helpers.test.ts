import { describe, it, expect } from "vitest";
import { activeKeyFor } from "./helpers";

/** Spec 0017 (Onboarding Generator): the tour route took over the
    "onboarding-tour" nav key from the add-repo wizard's `/onboarding` path
    (AC-45, AC-46). Every other existing rung must keep mapping as before. */
describe("activeKeyFor", () => {
  it("no longer maps the add-repo wizard route to onboarding-tour (AC-45)", () => {
    expect(activeKeyFor("/onboarding")).not.toBe("onboarding-tour");
  });

  it("maps the repo-scoped tour route to onboarding-tour (AC-46)", () => {
    expect(activeKeyFor("/repos/r1/tour")).toBe("onboarding-tour");
  });

  it("keeps every other existing rung mapped as before", () => {
    expect(activeKeyFor("/settings/api-keys")).toBe("settings");
    expect(activeKeyFor("/repos/r1/multi-agent")).toBe("multi-agent");
    expect(activeKeyFor("/repos/r1/context")).toBe("context");
    expect(activeKeyFor("/conventions")).toBe("conventions");
    expect(activeKeyFor("/repos/r1/pulls")).toBe("pulls");
    expect(activeKeyFor("/skills")).toBe("skills");
    expect(activeKeyFor("/agents")).toBe("agents");
    expect(activeKeyFor("/eval")).toBe("eval");
    expect(activeKeyFor("/memory")).toBe("memory");
    expect(activeKeyFor("/agent-performance")).toBe("agent-performance");
    expect(activeKeyFor("/ci-runs")).toBe("ci-runs");
  });

  it("falls back to an empty key for an unmapped route", () => {
    expect(activeKeyFor("/nowhere")).toBe("");
  });
});
