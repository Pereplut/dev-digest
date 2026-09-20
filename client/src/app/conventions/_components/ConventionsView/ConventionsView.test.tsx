import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ConventionPatch, ConventionsPage } from "@devdigest/shared";
import { makeCandidate, makeScan, makeSkillDefaults, renderWithProviders } from "../../_lib/test-utils";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    repoId: "r1",
    activeRepo: { id: "r1", full_name: "acme/payments-api" },
  }),
}));

const patchMutate = vi.fn<(v: { id: string; patch: ConventionPatch }) => void>();
const bulkMutate = vi.fn<(v: { ids: string[]; patch: ConventionPatch }) => void>();

let page: ConventionsPage = { candidates: [], scan: null };
let defaultsIsError = false;
let defaultsIsLoading = false;
let defaultsIsFetching = false;

vi.mock("@/lib/hooks/conventions", () => ({
  useConventions: () => ({ data: page, isLoading: false, isError: false, refetch: vi.fn() }),
  useExtractConventions: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  usePatchConvention: () => ({ mutate: patchMutate, isPending: false }),
  useBulkPatchConventions: () => ({ mutate: bulkMutate, isPending: false }),
  useConventionSkillDefaults: () => ({
    data: defaultsIsError ? undefined : makeSkillDefaults(),
    isError: defaultsIsError,
    isLoading: defaultsIsLoading,
    isFetching: defaultsIsFetching,
  }),
  useCreateConventionSkill: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

import { ConventionsView } from "./ConventionsView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  page = { candidates: [], scan: null };
  defaultsIsError = false;
  defaultsIsLoading = false;
  defaultsIsFetching = false;
});

describe("ConventionsView", () => {
  it("lists candidates, hides rejected behind a toggle and accepts one", async () => {
    const user = userEvent.setup();
    page = {
      candidates: [
        makeCandidate({ id: "c1", status: "pending" }),
        makeCandidate({ id: "c2", rule: "Name booleans is/has", status: "accepted" }),
        makeCandidate({
          id: "c3",
          rule: "Never swallow errors",
          status: "rejected",
          evidence_valid: false,
          rejected_reason: "snippet_not_found",
        }),
      ],
      scan: makeScan(),
    };
    renderWithProviders(<ConventionsView />);

    // The rejected one is partitioned out until asked for.
    expect(screen.getByText("Always use async/await instead of .then() chains")).toBeInTheDocument();
    expect(screen.queryByText("Never swallow errors")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show rejected" }));
    expect(screen.getByText("Never swallow errors")).toBeInTheDocument();

    const [firstAccept] = screen.getAllByRole("button", { name: "Accept" });
    if (!firstAccept) throw new Error("expected an Accept button to be rendered");
    await user.click(firstAccept);
    expect(patchMutate).toHaveBeenCalledWith({ id: "c1", patch: { status: "accepted" } });
  });

  it("renders the empty state, with no toolbar, when a repo has no candidates", () => {
    renderWithProviders(<ConventionsView />);
    expect(screen.getByRole("button", { name: "Scan repository" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deselect all" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create skill" })).not.toBeInTheDocument();
  });

  /**
   * Regression: "Deselect all" used to fire one PATCH per card. Each shared the
   * optimistic hook, so one failure rolled the cache back to a snapshot taken
   * before its siblings and silently reverted them too.
   */
  it("deselects every accepted candidate in ONE bulk mutation", async () => {
    const user = userEvent.setup();
    page = {
      candidates: [
        makeCandidate({ id: "c1", status: "accepted" }),
        makeCandidate({ id: "c2", rule: "Name booleans is/has", status: "accepted" }),
        makeCandidate({ id: "c3", rule: "Never swallow errors", status: "pending" }),
      ],
      scan: makeScan(),
    };
    renderWithProviders(<ConventionsView />);

    await user.click(screen.getByRole("button", { name: "Deselect all" }));

    expect(bulkMutate).toHaveBeenCalledTimes(1);
    expect(bulkMutate).toHaveBeenCalledWith({
      ids: ["c1", "c2"], // the pending one is left alone
      patch: { status: "pending" },
    });
    expect(patchMutate).not.toHaveBeenCalled();
  });

  /**
   * Regression: the modal rendered only on `modalOpen && defaults.data`, so a
   * failed (and silent, because 4xx) defaults fetch left `modalOpen` true with
   * nothing on screen — re-clicking set the same state, so the button was dead.
   */
  it("closes the modal and says so when the skill draft fails to load", async () => {
    const user = userEvent.setup();
    defaultsIsError = true;
    page = { candidates: [makeCandidate({ id: "c1", status: "accepted" })], scan: makeScan() };
    renderWithProviders(<ConventionsView />);

    const button = screen.getByRole("button", { name: "Create skill" });
    await user.click(button);

    await waitFor(() =>
      expect(screen.getByText("Could not load the skill draft. Please try again.")).toBeInTheDocument(),
    );
    // Still clickable, not stuck in a half-open state.
    expect(button).toBeEnabled();
    expect(screen.queryByRole("heading", { name: /Create skill from conventions/i })).not.toBeInTheDocument();
  });

  /**
   * Regression: TanStack keeps status 'error' while a re-enabled query
   * refetches, so gating only on `isError` made the NEXT click close the
   * just-opened modal and toast again before the refetch could settle — the
   * button stayed broken for one more click after every failure.
   */
  it("keeps the modal open while the previously failed draft query is refetching", async () => {
    const user = userEvent.setup();
    defaultsIsError = true;
    defaultsIsFetching = true;
    page = { candidates: [makeCandidate({ id: "c1", status: "accepted" })], scan: makeScan() };
    renderWithProviders(<ConventionsView />);

    await user.click(screen.getByRole("button", { name: "Create skill" }));

    await expect(
      screen.findByText(
        "Could not load the skill draft. Please try again.",
        {},
        { timeout: 250 },
      ),
    ).rejects.toThrow();
  });
});
