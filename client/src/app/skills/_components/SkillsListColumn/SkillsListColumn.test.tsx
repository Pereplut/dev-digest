import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Skill } from "@devdigest/shared";
import type { UpdateSkillInput } from "@/lib/hooks/skills";
import { makeSkill, renderWithProviders } from "../../_lib/test-utils";

const push = vi.fn<(href: string) => void>();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

let skillsState: { data?: Skill[]; isLoading: boolean; isError: boolean } = { isLoading: false, isError: false };
const updateMutate = vi.fn<(input: UpdateSkillInput) => void>();
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ ...skillsState, refetch: vi.fn() }),
  useUpdateSkill: () => ({ mutate: updateMutate }),
  usePreviewSkillImport: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useCreateSkill: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

import { SkillsListColumn } from "./SkillsListColumn";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  skillsState = { isLoading: false, isError: false };
});

describe("SkillsListColumn", () => {
  it("lists skills, filters by search, opens a skill, toggles it and opens the import modal", async () => {
    const user = userEvent.setup();
    skillsState.data = [
      makeSkill({ id: "a", name: "pr-quality-rubric" }),
      makeSkill({ id: "b", name: "no-then-chains", type: "convention", description: "Use async/await." }),
    ];
    renderWithProviders(<SkillsListColumn selectedId="a" />);

    expect(screen.getByText("pr-quality-rubric")).toBeInTheDocument();
    expect(screen.getByText("no-then-chains")).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Search skills" }), "async");
    expect(screen.queryByText("pr-quality-rubric")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /no-then-chains/ }));
    expect(push).toHaveBeenCalledWith("/skills/b");

    await user.click(screen.getByRole("switch", { name: /no-then-chains/ }));
    expect(updateMutate).toHaveBeenCalledWith({ id: "b", patch: { enabled: false } });

    await user.click(screen.getByRole("button", { name: "Add Skill" }));
    await user.click(screen.getByRole("button", { name: "Import skill" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the empty state when there are no skills", () => {
    skillsState.data = [];
    renderWithProviders(<SkillsListColumn />);
    expect(screen.getByText("No skills yet")).toBeInTheDocument();
  });
});
