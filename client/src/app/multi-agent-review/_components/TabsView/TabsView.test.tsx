import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/multiAgentReview.json";
import prReview from "../../../../../messages/en/prReview.json";
import evals from "../../../../../messages/en/evals.json";
import { column, finding } from "../testFixtures";

const findingMutate = vi.fn();
vi.mock("@/lib/hooks/evals", () => ({ useCreateEvalCase: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: findingMutate, isPending: false }),
}));

import { TabsView } from "./TabsView";

const fetchSpy = vi.fn();
beforeEach(() => {
  findingMutate.mockReset();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const columns = [
  column({ findings: [finding({ id: "f1", title: "Stripe key committed" })] }),
  column({
    run_id: "run-b",
    agent_id: "a2",
    agent_name: "Performance",
    score: 64,
    summary: "N+1 in the list endpoint.",
    findings: [finding({ id: "f2", title: "N+1 query" })],
  }),
];

function renderTabs(onViewTrace = vi.fn()) {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgentReview: messages, prReview, evals }}>
      <TabsView columns={columns} prId="pr1" onViewTrace={onViewTrace} />
    </NextIntlClientProvider>,
  );
  return { user, onViewTrace };
}

describe("TabsView", () => {
  it("shows a tab per agent and the selected agent's summary card and findings", async () => {
    const { user, onViewTrace } = renderTabs();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent("Security38");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    let panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Two critical exposures.")).toBeInTheDocument();
    expect(within(panel).getByText("Stripe key committed")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Performance/ }));
    panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("N+1 in the list endpoint.")).toBeInTheDocument();
    expect(within(panel).queryByText("Stripe key committed")).not.toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "View trace" }));
    expect(onViewTrace).toHaveBeenCalledWith("run-b");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("wires Accept to the finding action; Learn and Reply are disabled and send nothing", async () => {
    const { user } = renderTabs();
    const panel = screen.getByRole("tabpanel");

    await user.click(within(panel).getByRole("button", { name: "Accept" }));
    expect(findingMutate).toHaveBeenCalledWith(
      { findingId: "f1", action: "accept", reply: undefined, prId: "pr1" },
      expect.any(Object),
    );

    const learn = within(panel).getByRole("button", { name: "Learn" });
    const reply = within(panel).getByRole("button", { name: "Reply to author" });
    expect(learn).toBeDisabled();
    expect(reply).toBeDisabled();
    expect(learn).toHaveAccessibleDescription("Coming soon");
    await user.click(learn);
    await user.click(reply);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(findingMutate).toHaveBeenCalledTimes(1);
  });
});
