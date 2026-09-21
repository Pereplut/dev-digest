import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import type { SkillStats } from "@devdigest/shared";
import { renderWithProviders } from "../../../../_lib/test-utils";

let stats: SkillStats | undefined;
vi.mock("@/lib/hooks/skills", () => ({
  useSkillStats: () => ({ data: stats, isLoading: false, isError: false, refetch: vi.fn() }),
}));

import { StatsTab } from "./StatsTab";

afterEach(() => {
  cleanup();
  stats = undefined;
});

describe("StatsTab", () => {
  it("shows usage tiles, agents with Open links and a category legend of counts", () => {
    stats = {
      agent_count: 3,
      pull_rate: 0.71,
      accept_rate: 0.74,
      findings_30d: 96,
      agents: [
        { id: "ag1", name: "Security Reviewer" },
        { id: "ag2", name: "Performance Reviewer" },
      ],
      findings_by_category: [
        { category: "bug", count: 20 },
        { category: "security", count: 52 },
        { category: "style", count: 0 },
      ],
    };
    renderWithProviders(<StatsTab skillId="sk1" />);

    expect(screen.getByText("agents")).toBeInTheDocument();
    expect(screen.getByText("71")).toBeInTheDocument();
    expect(screen.getAllByText("74").length).toBeGreaterThan(0); // value + ring
    expect(screen.getByText("96")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Open Security Reviewer" })).toHaveAttribute(
      "href",
      "/agents/ag1?tab=skills",
    );

    // Legend lists non-empty categories, largest first, as plain counts.
    const legend = screen.getAllByRole("listitem").filter((li) => /security|bug|style/.test(li.textContent ?? ""));
    expect(legend.map((li) => li.textContent)).toEqual(["security52", "bug20"]);
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.getByText(/attributed to runs that included this skill/)).toBeInTheDocument();
  });

  it("renders — for null rates and empty states when nothing ran", () => {
    stats = {
      agent_count: 0,
      pull_rate: null,
      accept_rate: null,
      findings_30d: 0,
      agents: [],
      findings_by_category: [],
    };
    renderWithProviders(<StatsTab skillId="sk1" />);

    // Pull frequency and accept rate: a dash, no "%" and no ring.
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.queryByText("%")).not.toBeInTheDocument();
    expect(screen.getByText("No agent has this skill attached.")).toBeInTheDocument();
    expect(screen.getByText("No findings in the last 30 days.")).toBeInTheDocument();
  });
});
