import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Skill, SkillImportPreview } from "@devdigest/shared";
import type { CreateSkillInput } from "@/lib/hooks/skills";
import { makeSkill, renderWithProviders } from "../../_lib/test-utils";

const push = vi.fn<(href: string) => void>();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const PREVIEW: SkillImportPreview = {
  draft: {
    name: "flaky-test-patterns",
    description: "Flags tests that depend on timing or order.",
    type: "rubric",
    body: "## Flaky tests\n- Sleeps instead of waits",
  },
  source_filename: "flaky-test-patterns.zip",
  ignored_files: [
    { path: "scripts/detect.sh", reason: "executable — not processed" },
    { path: "README.txt", reason: "not markdown" },
  ],
  name_conflict: true,
};

type MutateOpts<T> = { onSuccess?: (data: T) => void };
const parseMutate = vi.fn<(file: File, opts?: MutateOpts<SkillImportPreview>) => void>();
const createMutate = vi.fn<(input: CreateSkillInput, opts?: MutateOpts<Skill>) => void>();

vi.mock("@/lib/hooks/skills", () => ({
  usePreviewSkillImport: () => ({ mutate: parseMutate, isPending: false, error: null }),
  useCreateSkill: () => ({ mutate: createMutate, isPending: false, error: null }),
}));

import { ImportSkillModal } from "./ImportSkillModal";

beforeEach(() => {
  parseMutate.mockImplementation((_file, opts) => opts?.onSuccess?.(PREVIEW));
  createMutate.mockImplementation((input, opts) =>
    opts?.onSuccess?.(makeSkill({ id: "sk-new", name: input.name, source: "imported_file" })),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ImportSkillModal", () => {
  it("previews without saving, then creates with the edited name and source imported_file on Confirm", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn<() => void>();
    renderWithProviders(<ImportSkillModal onClose={onClose} />);

    const file = new File(["zip"], "flaky-test-patterns.zip", { type: "application/zip" });
    await user.upload(screen.getByLabelText("Skill file"), file);
    expect(parseMutate).toHaveBeenCalledWith(file, expect.anything());

    // Preview step: warning, ignored files, rendered body — and nothing created yet.
    expect(screen.getByText(/someone else's instructions inside your agent's system prompt/)).toBeInTheDocument();
    expect(screen.getByText("scripts/detect.sh")).toBeInTheDocument();
    expect(screen.getByText("executable — not processed")).toBeInTheDocument();
    expect(screen.getByText("README.txt")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Flaky tests" })).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();

    // The conflicting name blocks Confirm until it is changed.
    const confirm = screen.getByRole("button", { name: "Import skill" });
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/already exists/)).toBeInTheDocument();

    const nameInput = screen.getByLabelText("Name");
    await user.clear(nameInput);
    await user.type(nameInput, "flaky-tests-v2");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate).toHaveBeenCalledWith(
      { ...PREVIEW.draft, name: "flaky-tests-v2", source: "imported_file" },
      expect.anything(),
    );
    expect(onClose).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/skills/sk-new?tab=preview");
  });

  it("Cancel discards the preview without creating anything", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn<() => void>();
    renderWithProviders(<ImportSkillModal onClose={onClose} />);

    await user.upload(screen.getByLabelText("Skill file"), new File(["# x"], "x.md", { type: "text/markdown" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
    expect(createMutate).not.toHaveBeenCalled();
  });
});
