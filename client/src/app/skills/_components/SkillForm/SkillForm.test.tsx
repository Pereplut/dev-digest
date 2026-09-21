import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Skill } from "@devdigest/shared";
import type { CreateSkillInput, UpdateSkillInput } from "@/lib/hooks/skills";
import { ApiError } from "@/lib/api";
import { makeSkill, renderWithProviders } from "../../_lib/test-utils";

const push = vi.fn<(href: string) => void>();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

type MutateOpts<T> = { onSuccess?: (data: T) => void };
const createMutate = vi.fn<(input: CreateSkillInput, opts?: MutateOpts<Skill>) => void>();
const updateMutate = vi.fn<(input: UpdateSkillInput, opts?: MutateOpts<Skill>) => void>();
const deleteMutate = vi.fn<(id: string, opts?: MutateOpts<{ ok: boolean }>) => void>();
let updateError: Error | null = null;

vi.mock("@/lib/hooks/skills", () => ({
  useCreateSkill: () => ({ mutate: createMutate, isPending: false, error: null }),
  useUpdateSkill: () => ({ mutate: updateMutate, isPending: false, error: updateError }),
  useDeleteSkill: () => ({ mutate: deleteMutate, isPending: false }),
}));

import { SkillForm } from "./SkillForm";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  updateError = null;
});

describe("SkillForm", () => {
  it("blocks an invalid draft client-side, then creates a valid one and opens its preview", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_input, opts) => opts?.onSuccess?.(makeSkill({ id: "new-id" })));
    renderWithProviders(<SkillForm />);

    await user.click(screen.getByRole("button", { name: "Create skill" }));
    expect(screen.getAllByText("Required.")).toHaveLength(3); // name, description, body
    expect(createMutate).not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox", { name: "Name" }), "x".repeat(81));
    await user.type(screen.getByRole("textbox", { name: "Description" }), "  Flags missing tests.  ");
    await user.type(screen.getByPlaceholderText("## …"), "Check every branch.");
    await user.click(screen.getByRole("button", { name: "Create skill" }));
    expect(screen.getByText("At most 80 characters.")).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();

    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "untested-branches");
    await user.selectOptions(screen.getByRole("combobox"), "rubric");

    // Write/Preview toggle renders the body as markdown.
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText("Check every branch.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create skill" }));
    expect(createMutate).toHaveBeenCalledWith(
      { name: "untested-branches", description: "Flags missing tests.", type: "rubric", body: "Check every branch." },
      expect.anything(),
    );
    expect(push).toHaveBeenCalledWith("/skills/new-id?tab=preview");
  });

  it("saves an edit with its change note, shows a server conflict inline, and confirms delete with the agent count", async () => {
    const user = userEvent.setup();
    const skill = makeSkill({ stats: { agent_count: 2, pull_rate: null, accept_rate: null } });
    renderWithProviders(<SkillForm skill={skill} />);

    await user.type(screen.getByRole("textbox", { name: "Change note" }), "Tightened scope");
    await user.click(screen.getByRole("button", { name: "Save skill" }));
    expect(updateMutate).toHaveBeenCalledWith(
      {
        id: "sk1",
        patch: {
          name: skill.name,
          description: skill.description,
          type: skill.type,
          body: skill.body,
          message: "Tightened scope",
        },
      },
      expect.anything(),
    );

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/used by 2 agents/));
    expect(deleteMutate).not.toHaveBeenCalled();

    cleanup();
    updateError = new ApiError("A skill named pr-quality-rubric already exists", 409, "conflict");
    renderWithProviders(<SkillForm skill={skill} />);
    expect(screen.getByRole("alert")).toHaveTextContent("already exists");
  });
});
