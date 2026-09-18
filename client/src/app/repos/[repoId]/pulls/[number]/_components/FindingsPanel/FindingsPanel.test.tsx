/**
 * FindingsPanel — the Review runs card body. Severity pills ("N critical ·
 * N warning · N suggestion", only severities present) count exactly the cards
 * rendered below; clicking a pill filters the cards to that severity and a
 * second click restores the full list.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

function finding(o: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  } as FindingRecord;
}

const FINDINGS: FindingRecord[] = [
  finding({ id: "c1", severity: "CRITICAL", title: "Hardcoded secret", confidence: 0.95 }),
  finding({ id: "w1", severity: "WARNING", title: "N+1 query", confidence: 0.9 }),
  finding({ id: "w2", severity: "WARNING", title: "Unbounded loop", confidence: 0.5 }),
  finding({ id: "w3", severity: "WARNING", title: "Rejected warning", dismissed_at: "2026-09-15T10:00:00Z" }),
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** Cards currently rendered, by severity (a card is a `[data-finding-id]`). */
function cardIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-finding-id]")].map((el) => el.getAttribute("data-finding-id")!);
}

describe("FindingsPanel", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS.slice(0, 1)} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state (and no pills) when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Filter findings by severity" })).not.toBeInTheDocument();
  });
});

describe("FindingsPanel — severity pills", () => {
  it("each pill's number equals the cards of that severity below; absent severities get no pill", () => {
    const { container } = renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    const group = screen.getByRole("group", { name: "Filter findings by severity" });
    const pills = within(group).getAllByRole("button");
    expect(pills.map((p) => p.getAttribute("aria-label"))).toEqual(["1 critical", "3 warning"]);
    expect(within(group).queryByRole("button", { name: /suggestion/ })).not.toBeInTheDocument();

    const ids = cardIds(container);
    expect(ids.filter((id) => id.startsWith("c"))).toHaveLength(1);
    expect(ids.filter((id) => id.startsWith("w"))).toHaveLength(3); // rejected ones are still cards
  });

  it("clicking a pill filters the cards; clicking it again restores the full list", async () => {
    const user = userEvent.setup();
    const { container } = renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    const warning = screen.getByRole("button", { name: "3 warning" });
    expect(warning).toHaveAttribute("aria-pressed", "false");

    await user.click(warning);
    expect(warning).toHaveAttribute("aria-pressed", "true");
    expect(cardIds(container).sort()).toEqual(["w1", "w2", "w3"]);
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();

    await user.click(warning);
    expect(warning).toHaveAttribute("aria-pressed", "false");
    expect(cardIds(container).sort()).toEqual(["c1", "w1", "w2", "w3"]);
  });

  it("switching pills moves the filter to the other severity", async () => {
    const user = userEvent.setup();
    const { container } = renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    await user.click(screen.getByRole("button", { name: "3 warning" }));
    await user.click(screen.getByRole("button", { name: "1 critical" }));
    expect(screen.getByRole("button", { name: "1 critical" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "3 warning" })).toHaveAttribute("aria-pressed", "false");
    expect(cardIds(container)).toEqual(["c1"]);
  });

  it("hiding low confidence updates the counts, and a filter whose cards all disappear clears itself", async () => {
    const user = userEvent.setup();
    const lowCritical = [
      finding({ id: "c1", severity: "CRITICAL", confidence: 0.4 }),
      finding({ id: "w1", severity: "WARNING", title: "N+1 query", confidence: 0.9 }),
    ];
    const { container } = renderWithIntl(<FindingsPanel findings={lowCritical} prId="pr1" />);
    await user.click(screen.getByRole("button", { name: "1 critical" }));
    expect(cardIds(container)).toEqual(["c1"]);

    await user.click(screen.getByRole("switch"));
    expect(screen.queryByRole("button", { name: /critical/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 warning" })).toHaveAttribute("aria-pressed", "false");
    expect(cardIds(container)).toEqual(["w1"]);
  });
});
