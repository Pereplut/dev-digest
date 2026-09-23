/**
 * OverviewTab — the intent card was added above the description (spec 0008),
 * so this pins that the description still renders and the order is right.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OverviewTab } from "./OverviewTab";

vi.mock("../PrIntentCard", () => ({
  PrIntentCard: ({ prId }: { prId: string | null }) => (
    <div data-testid="intent-card">{prId ?? "no-pr"}</div>
  ),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

describe("OverviewTab", () => {
  it("still renders the PR description", () => {
    render(<OverviewTab prBody="Adds a readiness probe." prId="pr-1" />);
    expect(screen.getByText("Adds a readiness probe.")).toBeInTheDocument();
  });

  it("renders the intent card above the description", () => {
    const { container } = render(<OverviewTab prBody="BODY TEXT" prId="pr-1" />);
    const html = container.innerHTML;
    expect(html.indexOf("intent-card")).toBeLessThan(html.indexOf("BODY TEXT"));
  });

  it("passes the pr id through", () => {
    render(<OverviewTab prBody={null} prId="pr-42" />);
    expect(screen.getByTestId("intent-card")).toHaveTextContent("pr-42");
  });

  /** A PR with no body is normal; the tab must not render an empty box. */
  it("omits the description section when there is no body", () => {
    render(<OverviewTab prBody={null} prId="pr-1" />);
    expect(screen.queryByText("overview.description")).not.toBeInTheDocument();
  });
});
