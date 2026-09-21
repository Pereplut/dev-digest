import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Skill, SkillStats, SkillVersion } from "@devdigest/shared";
import { makeSkill, renderWithProviders } from "../../_lib/test-utils";
import { parseTab } from "./helpers";
import type { SkillTab } from "./constants";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const STATS: SkillStats = {
  agent_count: 1,
  pull_rate: 0.5,
  accept_rate: null,
  findings_30d: 4,
  agents: [{ id: "ag1", name: "Security Reviewer" }],
  findings_by_category: [],
};
const VERSIONS: SkillVersion[] = [];
const idle = { mutate: vi.fn(), isPending: false, error: null };
vi.mock("@/lib/hooks/skills", () => ({
  useSkillStats: () => ({ data: STATS, isLoading: false, isError: false, refetch: vi.fn() }),
  useSkillVersions: () => ({ data: VERSIONS, isLoading: false, isError: false, refetch: vi.fn() }),
  useRestoreSkillVersion: () => idle,
  useCreateSkill: () => idle,
  useUpdateSkill: () => idle,
  useDeleteSkill: () => idle,
}));

import { SkillDetail } from "./SkillDetail";

afterEach(cleanup);

/** Holds the tab like the route does with ?tab=. */
function Harness({ skill, initial }: { skill: Skill; initial: SkillTab }) {
  const [tab, setTab] = React.useState<SkillTab>(initial);
  return <SkillDetail skill={skill} tab={tab} onTab={setTab} />;
}

describe("SkillDetail", () => {
  it("renders only the shipped tabs and switches between them", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness skill={makeSkill({ version: 5 })} initial="preview" />);

    expect(screen.getByRole("heading", { level: 1, name: "pr-quality-rubric" })).toBeInTheDocument();
    expect(screen.getByText("v5")).toBeInTheDocument();
    for (const name of ["Config", "Preview", "Stats", "Versions"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    for (const name of ["Context", "Evals", "Run on evals"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }

    // Preview: the block the agent receives, plus its token cost.
    expect(screen.getByText("Rendered as the reviewing agent receives it.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Skill: pr-quality-rubric" })).toBeInTheDocument();
    expect(screen.getByText("≈ 120 tokens added to the system prompt")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stats" }));
    expect(screen.getByText("Agents using this skill")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Versions" }));
    expect(screen.getByText("Version history")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Config" }));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("pr-quality-rubric");
  });

  it("falls back to Preview for a hidden or unknown ?tab=", () => {
    expect(parseTab("evals")).toBe("preview");
    expect(parseTab("nope")).toBe("preview");
    expect(parseTab(null)).toBe("preview");
    expect(parseTab("stats")).toBe("stats");
  });
});
