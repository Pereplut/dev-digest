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
vi.mock("../BlastRadiusCard", () => ({
  BlastRadiusCard: ({
    prId,
    repoFullName,
    headSha,
  }: {
    prId: string | null;
    repoFullName: string | null | undefined;
    headSha: string | null | undefined;
  }) => (
    <div data-testid="blast-card">
      {prId ?? "no-pr"}|{repoFullName ?? "no-repo"}|{headSha ?? "no-sha"}
    </div>
  ),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const baseProps = { repoFullName: "acme/payments-api", headSha: "abc123" };

describe("OverviewTab", () => {
  it("still renders the PR description", () => {
    render(<OverviewTab prBody="Adds a readiness probe." prId="pr-1" {...baseProps} />);
    expect(screen.getByText("Adds a readiness probe.")).toBeInTheDocument();
  });

  it("renders the intent card, then the blast radius card, above the description", () => {
    const { container } = render(<OverviewTab prBody="BODY TEXT" prId="pr-1" {...baseProps} />);
    const html = container.innerHTML;
    expect(html.indexOf("intent-card")).toBeLessThan(html.indexOf("blast-card"));
    expect(html.indexOf("blast-card")).toBeLessThan(html.indexOf("BODY TEXT"));
  });

  it("passes the pr id through to both cards", () => {
    render(<OverviewTab prBody={null} prId="pr-42" {...baseProps} />);
    expect(screen.getByTestId("intent-card")).toHaveTextContent("pr-42");
    expect(screen.getByTestId("blast-card")).toHaveTextContent("pr-42");
  });

  /**
   * The mock used to render only `prId`, so a swapped or mistyped
   * `repoFullName`/`headSha` prop would pass silently. Render both through the
   * mock and assert the exact values arrive at BlastRadiusCard.
   */
  it("passes repoFullName and headSha through to the blast radius card", () => {
    render(
      <OverviewTab
        prBody={null}
        prId="pr-42"
        repoFullName="acme/payments-api"
        headSha="deadbeef"
      />,
    );
    expect(screen.getByTestId("blast-card")).toHaveTextContent(
      "pr-42|acme/payments-api|deadbeef",
    );
  });

  it("passes a missing repoFullName/headSha through as-is (no default substituted)", () => {
    render(<OverviewTab prBody={null} prId="pr-42" repoFullName={null} headSha={undefined} />);
    expect(screen.getByTestId("blast-card")).toHaveTextContent("pr-42|no-repo|no-sha");
  });

  /** A PR with no body is normal; the tab must not render an empty box. */
  it("omits the description section when there is no body", () => {
    render(<OverviewTab prBody={null} prId="pr-1" {...baseProps} />);
    expect(screen.queryByText("overview.description")).not.toBeInTheDocument();
  });
});
