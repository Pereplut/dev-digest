import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/multiAgentReview.json";

const push = vi.fn();
const mutateAsync = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({
    data: [
      { id: "a1", name: "Security", enabled: true, est_duration_ms: 6400, est_cost_usd: 0.06 },
      { id: "a2", name: "Performance", enabled: true, est_duration_ms: null, est_cost_usd: null },
      { id: "a3", name: "Retired", enabled: false, est_duration_ms: 1000, est_cost_usd: 0.01 },
    ],
  }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync, isPending: false }),
}));

import { AgentPicker } from "./AgentPicker";

beforeEach(() => {
  push.mockReset();
  mutateAsync.mockReset();
});
afterEach(cleanup);

function renderPicker(props: Partial<React.ComponentProps<typeof AgentPicker>> = {}) {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgentReview: messages }}>
      <AgentPicker prId="pr1" {...props} />
    </NextIntlClientProvider>,
  );
  return user;
}

const runBtn = (n: number) => screen.getByRole("button", { name: `Run multi-agent review (${n})` });

describe("AgentPicker", () => {
  it("lists enabled agents with estimates, selects all, clears, and links to Configure run", async () => {
    const user = renderPicker();
    await user.click(screen.getByRole("button", { name: "Run Review" }));

    expect(screen.getByRole("checkbox", { name: "Security" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Performance" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Retired" })).not.toBeInTheDocument();
    expect(screen.getByText("~6s")).toBeInTheDocument();
    expect(screen.getByText("no history")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configure agents…" })).toHaveAttribute(
      "href",
      "/multi-agent-review?new=1&pr=pr1",
    );

    // Disabled at zero checked.
    expect(runBtn(0)).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByRole("checkbox", { name: "Security" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Performance" })).toBeChecked();
    expect(runBtn(2)).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("checkbox", { name: "Security" })).not.toBeChecked();
    expect(runBtn(0)).toBeDisabled();
  });

  it("one checked agent posts [id] and stays on the page", async () => {
    mutateAsync.mockResolvedValue({ pr_id: "pr1", runs: [{ run_id: "r1" }], reviews: [], multi_run_id: null });
    const onRunsStarted = vi.fn();
    const user = renderPicker({ onRunsStarted });
    await user.click(screen.getByRole("button", { name: "Run Review" }));
    await user.click(screen.getByRole("checkbox", { name: "Security" }));
    await user.click(runBtn(1));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr1", agentIds: ["a1"] });
    expect(onRunsStarted).toHaveBeenCalledWith(["r1"]);
    expect(push).not.toHaveBeenCalled();
  });

  it("two checked agents post both ids in ONE request and navigate to the results page", async () => {
    mutateAsync.mockResolvedValue({ pr_id: "pr1", runs: [], reviews: [], multi_run_id: "m1" });
    const onRunsStarted = vi.fn();
    const user = renderPicker({ onRunsStarted });
    await user.click(screen.getByRole("button", { name: "Run Review" }));
    await user.click(screen.getByRole("checkbox", { name: "Security" }));
    await user.click(screen.getByRole("checkbox", { name: "Performance" }));
    await user.click(runBtn(2));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr1", agentIds: ["a1", "a2"] });
    expect(push).toHaveBeenCalledWith("/multi-agent-review/m1");
    expect(onRunsStarted).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const user = renderPicker();
    await user.click(screen.getByRole("button", { name: "Run Review" }));
    expect(screen.getByRole("group", { name: "Pick agents to run" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Pick agents to run" })).not.toBeInTheDocument();
  });
});
