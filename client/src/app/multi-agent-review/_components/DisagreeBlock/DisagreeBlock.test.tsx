import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/multiAgentReview.json";
import prReview from "../../../../../messages/en/prReview.json";
import evals from "../../../../../messages/en/evals.json";
import { column, conflict, finding } from "../testFixtures";

// FindingCard calls these hooks; without a mock the render crashes (client/INSIGHTS.md:206).
vi.mock("@/lib/hooks/evals", () => ({ useCreateEvalCase: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("@/lib/hooks/reviews", () => ({ useFindingAction: () => ({ mutate: vi.fn(), isPending: false }) }));

import { DisagreeBlock } from "./DisagreeBlock";

afterEach(cleanup);

const EVIL = "<img src=x onerror=alert(1)>";
const columns = [
  column({ findings: [finding({ id: "f1", title: EVIL })] }),
  column({ run_id: "run-b", agent_id: "a2", agent_name: "Performance", findings: [finding({ id: "f2", severity: "SUGGESTION", title: "Nit" })] }),
];
const conflicts = [
  conflict({ title: EVIL }),
  conflict({
    file: "src/other.ts",
    start_line: 3,
    end_line: 9,
    title: "Agreed group",
    divergent: false,
    takes: [
      { run_id: "run-a", agent_id: "a1", persona: null, verdict: "WARNING", note: "", finding_ids: ["f1"] },
      { run_id: "run-b", agent_id: "a2", persona: null, verdict: "WARNING", note: "", finding_ids: ["f2"] },
    ],
  }),
];

function renderBlock() {
  const user = userEvent.setup();
  const view = render(
    <NextIntlClientProvider locale="en" messages={{ multiAgentReview: messages, prReview, evals }}>
      <DisagreeBlock conflicts={conflicts} columns={columns} prId="pr1" />
    </NextIntlClientProvider>,
  );
  return { user, ...view };
}

describe("DisagreeBlock", () => {
  it("renders a row per group with a cell per take, and filters to conflicts", async () => {
    const { user } = renderBlock();
    const region = screen.getByRole("region", { name: "Where agents disagree" });

    expect(within(region).getByText("src/mw/ratelimit.ts:52")).toBeInTheDocument();
    expect(within(region).getByText("src/other.ts:3–9")).toBeInTheDocument();
    // The silent take renders as "did not flag", the flagged one with its note.
    expect(within(region).getByText("did not flag")).toBeInTheDocument();
    expect(within(region).getByText("Needs Retry-After.")).toBeInTheDocument();
    expect(within(region).getByText("Agreed group")).toBeInTheDocument();

    await user.click(within(region).getByRole("checkbox", { name: "Show only conflicts" }));
    expect(within(region).queryByText("Agreed group")).not.toBeInTheDocument();
    expect(within(region).getByText("src/mw/ratelimit.ts:52")).toBeInTheDocument();

    await user.click(within(region).getByRole("checkbox", { name: "Show only conflicts" }));
    expect(within(region).getByText("Agreed group")).toBeInTheDocument();
  });

  it("expands a group into agent-labelled finding cards", async () => {
    const { user } = renderBlock();
    const region = screen.getByRole("region", { name: "Where agents disagree" });
    const expand = within(region).getByRole("button", { name: "Show findings for src/other.ts:3–9" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    await user.click(expand);

    expect(
      within(region).getByRole("button", { name: "Hide findings for src/other.ts:3–9" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(within(region).getByText("Reported by Security")).toBeInTheDocument();
    expect(within(region).getByText("Reported by Performance")).toBeInTheDocument();
    expect(within(region).getByText("Nit")).toBeInTheDocument();
    // Exact names: the card header is itself role="button" (client/INSIGHTS.md:126).
    expect(within(region).getAllByRole("button", { name: "Accept" })).toHaveLength(2);
  });

  it("keeps a group expanded when a refetch reorders the list (stable keys, not indices)", async () => {
    const user = userEvent.setup();
    const ui = (list: typeof conflicts) => (
      <NextIntlClientProvider locale="en" messages={{ multiAgentReview: messages, prReview, evals }}>
        <DisagreeBlock conflicts={list} columns={columns} prId="pr1" />
      </NextIntlClientProvider>
    );
    const { rerender } = render(ui(conflicts));
    await user.click(screen.getByRole("button", { name: "Show findings for src/other.ts:3–9" }));

    rerender(ui([...conflicts].reverse()));

    expect(screen.getByRole("button", { name: "Hide findings for src/other.ts:3–9" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "Show findings for src/mw/ratelimit.ts:52" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("renders model text as text — an <img onerror> title creates no img", () => {
    const { container } = renderBlock();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByText(EVIL).length).toBeGreaterThan(0);
  });
});
