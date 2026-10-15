import { describe, it, expect } from "vitest";
import type { CiInstallation } from "@devdigest/shared";
import { NO_VALUE } from "./constants";
import { formatDate, formatTimestamp, hasGhaInstallation, prLabel, repoById } from "./helpers";

function inst(id: string, repo: string, target_type: CiInstallation["target_type"]): CiInstallation {
  return {
    id,
    agent_id: "ag1",
    repo,
    target_type,
    installed_at: "2026-09-30T10:00:00.000Z",
    status: "active",
    workflow_version: 1,
    triggers: [],
    post_as: "none",
    pr_url: null,
    last_run: null,
  };
}

describe("CiTab helpers", () => {
  it("formatTimestamp: null, empty and invalid input give the placeholder; a valid ISO string is localised", () => {
    expect(formatTimestamp(null)).toBe(NO_VALUE);
    expect(formatTimestamp(undefined)).toBe(NO_VALUE);
    expect(formatTimestamp("")).toBe(NO_VALUE);
    expect(formatTimestamp("not a date")).toBe(NO_VALUE);
    expect(formatTimestamp("2026-10-01T12:00:00.000Z")).toBe(new Date("2026-10-01T12:00:00.000Z").toLocaleString());
  });

  it("formatDate: a valid ISO string is a locale date; invalid input is returned unchanged", () => {
    expect(formatDate("2026-10-01T12:00:00.000Z")).toBe(new Date("2026-10-01T12:00:00.000Z").toLocaleDateString());
    expect(formatDate("garbage")).toBe("garbage");
  });

  it("hasGhaInstallation: true only when some installation targets gha; undefined and empty are false", () => {
    expect(hasGhaInstallation(undefined)).toBe(false);
    expect(hasGhaInstallation([])).toBe(false);
    expect(hasGhaInstallation([inst("a", "o/a", "circle"), inst("b", "o/b", "jenkins")])).toBe(false);
    expect(hasGhaInstallation([inst("a", "o/a", "circle"), inst("b", "o/b", "gha")])).toBe(true);
  });

  it("repoById maps installation id to repo; undefined gives an empty map", () => {
    const map = repoById([inst("a", "o/a", "gha"), inst("b", "o/b", "gha")]);
    expect(map.get("a")).toBe("o/a");
    expect(map.get("b")).toBe("o/b");
    expect(map.get("missing")).toBeUndefined();
    expect(repoById(undefined).size).toBe(0);
  });

  it("prLabel: '#n' for a number, placeholder for null", () => {
    expect(prLabel(42)).toBe("#42");
    expect(prLabel(null)).toBe(NO_VALUE);
  });
});
