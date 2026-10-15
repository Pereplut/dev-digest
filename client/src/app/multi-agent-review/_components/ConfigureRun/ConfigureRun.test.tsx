import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/multiAgentReview.json";

const push = vi.fn();
const mutateAsync = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ repoId: "repo1" }) }));
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({
    data: [
      { id: "a1", name: "Security", description: "Finds exposures", enabled: true, est_duration_ms: 8200, est_cost_usd: 0.06 },
      { id: "a2", name: "Performance", description: "Finds N+1", enabled: true, est_duration_ms: 7400, est_cost_usd: 0.05 },
      { id: "a3", name: "Mentor", description: "Nits", enabled: true, est_duration_ms: null, est_cost_usd: null },
      { id: "a4", name: "Retired", description: "Off", enabled: false, est_duration_ms: 1, est_cost_usd: 1 },
    ],
  }),
}));
vi.mock("@/lib/hooks/core", () => ({
  usePulls: () => ({ data: [{ id: "pr1", number: 482, title: "Add limiter" }] }),
  usePullDetail: (id: string | null) => ({
    data: id === "pr9" ? { id: "pr9", number: 9, title: "Other repo PR" } : undefined,
  }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync, isPending: false }),
}));

import { ConfigureRun } from "./ConfigureRun";

beforeEach(() => {
  push.mockReset();
  mutateAsync.mockReset();
});
afterEach(cleanup);

function renderConfigure(initialPrId?: string) {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgentReview: messages }}>
      <ConfigureRun initialPrId={initialPrId} />
    </NextIntlClientProvider>,
  );
  return user;
}

const runBtn = (n: number) => screen.getByRole("button", { name: `Run multi-agent review (${n})` });

describe("ConfigureRun", () => {
  it("shows the empty state until a PR is picked, then one card per enabled agent", async () => {
    const user = renderConfigure();
    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(runBtn(0)).toBeDisabled();

    await user.selectOptions(screen.getByRole("combobox"), "pr1");

    expect(screen.queryByText("Pick a pull request first")).not.toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    expect(screen.queryByRole("checkbox", { name: "Retired" })).not.toBeInTheDocument();
    expect(screen.getByText("Finds exposures")).toBeInTheDocument();
    expect(screen.getByText("8.2s · $0.06")).toBeInTheDocument();
    expect(screen.getByText("no history")).toBeInTheDocument();
  });

  it("preselects the PR from ?pr=, even one outside the active repo's list", () => {
    renderConfigure("pr9");
    expect(screen.getByRole("combobox")).toHaveValue("pr9");
    expect(screen.getByRole("option", { name: "#9 · Other repo PR" })).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("enables run only from two agents and sums estimates over agents with history", async () => {
    const user = renderConfigure("pr1");
    expect(screen.queryByText(/parallel fan-out/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Mentor" }));
    expect(runBtn(1)).toBeDisabled();
    // The only checked agent has no history: no summary at all.
    expect(screen.queryByText(/parallel fan-out/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Security" }));
    expect(runBtn(2)).toBeEnabled();
    // Mentor (no history) changes neither total.
    expect(screen.getByText("≈ 8.2s · $0.06 · parallel fan-out")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(runBtn(3)).toBeEnabled();
    expect(screen.getByText("≈ 8.2s · $0.11 · parallel fan-out")).toBeInTheDocument();
  });

  it("posts exactly the checked ids in one request and opens the results page", async () => {
    mutateAsync.mockResolvedValue({ pr_id: "pr1", runs: [], reviews: [], multi_run_id: "m7" });
    const user = renderConfigure("pr1");
    await user.click(screen.getByRole("checkbox", { name: "Security" }));
    await user.click(screen.getByRole("checkbox", { name: "Performance" }));
    await user.click(runBtn(2));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr1", agentIds: ["a1", "a2"] });
    expect(push).toHaveBeenCalledWith("/multi-agent-review/m7");
  });
});
