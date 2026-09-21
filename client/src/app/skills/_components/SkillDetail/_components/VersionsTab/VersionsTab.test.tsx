import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Skill, SkillVersion } from "@devdigest/shared";
import { makeSkill, renderWithProviders } from "../../../../_lib/test-utils";

const CURRENT_BODY = "Evaluate the PR.\nCheck tests.\nCap at 5 findings.";
const VERSIONS: SkillVersion[] = [
  {
    version: 1,
    name: "pr-quality-rubric",
    description: "d",
    type: "rubric",
    body: "Evaluate the PR.\nCheck style.",
    message: "Initial rubric",
    created_at: "2026-03-02T09:00:00.000Z",
  },
  {
    version: 2,
    name: "pr-quality-rubric",
    description: "d",
    type: "rubric",
    body: CURRENT_BODY,
    message: null,
    created_at: "2026-05-30T09:00:00.000Z",
  },
];

type MutateOpts<T> = { onSuccess?: (data: T) => void };
const restoreMutate = vi.fn<(input: { id: string; version: number }, opts?: MutateOpts<Skill>) => void>();
vi.mock("@/lib/hooks/skills", () => ({
  useSkillVersions: () => ({ data: VERSIONS, isLoading: false, isError: false, refetch: vi.fn() }),
  useRestoreSkillVersion: () => ({ mutate: restoreMutate, isPending: false }),
}));

import { VersionsTab } from "./VersionsTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const SKILL = makeSkill({ version: 2, body: CURRENT_BODY });

describe("VersionsTab", () => {
  it("lists versions newest first with the Current badge on the latest, and diffs an older one", async () => {
    const user = userEvent.setup();
    renderWithProviders(<VersionsTab skill={SKILL} />);

    expect(screen.getByText("2 versions")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["v2", "v1"]);
    const latest = screen.getByRole("listitem", { name: "v2" });
    const older = screen.getByRole("listitem", { name: "v1" });
    expect(within(latest).getByText("v2")).toBeInTheDocument();
    expect(within(latest).getByText("Current")).toBeInTheDocument();
    expect(within(latest).getByText("Edited")).toBeInTheDocument(); // null message
    expect(within(latest).queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    expect(within(older).getByText("Initial rubric")).toBeInTheDocument();
    expect(within(older).getByText("2026-03-02")).toBeInTheDocument();

    await user.click(within(older).getByRole("button", { name: "Diff" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("v1 → v2 (current)")).toBeInTheDocument();
    expect(within(dialog).getByText("Check style.").parentElement).toHaveTextContent(/^-Check style\.$/);
    expect(within(dialog).getByText("Check tests.").parentElement).toHaveTextContent(/^\+Check tests\.$/);
    expect(within(dialog).getByText("Evaluate the PR.").parentElement).toHaveTextContent(/^\s*Evaluate the PR\.$/);
  });

  it("restores an older version only after confirmation", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWithProviders(<VersionsTab skill={SKILL} />);

    const older = screen.getByRole("listitem", { name: "v1" });
    await user.click(within(older).getByRole("button", { name: "Restore" }));
    expect(restoreMutate).not.toHaveBeenCalled();

    await user.click(within(older).getByRole("button", { name: "Restore" }));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(restoreMutate).toHaveBeenCalledWith({ id: "sk1", version: 1 }, expect.anything());
  });
});
