/**
 * SeverityCounts + FindingsPopover — chips hide zero counts, the trigger has an
 * accessible summary, and the portalled card opens on hover/focus/Enter, closes
 * on leave/Escape, is read-only (no buttons), and never lets a click reach the
 * surrounding row.
 *
 * These tests drive the trigger with user-event, which fires the real pointer
 * and focus sequences. Two consequences are load-bearing here:
 *  - FOCUS OPENS THE CARD (onFocus={openSoon}), and Enter TOGGLES it. So a
 *    focus-then-Enter sequence opens and then closes; each test starts from the
 *    state it actually wants rather than assuming Enter always opens.
 *  - The harness passes delayMs={0}, which also disables the CLOSE_DELAY_MS
 *    grace period. Moving a real pointer off the trigger therefore closes the
 *    card immediately, so the click-through test below still uses fireEvent for
 *    the in-card click — see the comment there.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, FindingsCounts } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import { FindingsPopover } from "./FindingsPopover";
import { SeverityCounts, useSeverityCountsLabel } from "./SeverityCounts";

afterEach(cleanup);

const FINDINGS = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key in commit",
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "Line 12 contains a literal Stripe secret key.",
    suggestion: null,
    confidence: 0.98,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rv1",
    accepted_at: null,
    dismissed_at: null,
  },
  {
    id: "f2",
    severity: "WARNING",
    category: "perf",
    title: "N+1 query in user list endpoint",
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 52,
    rationale: "The loop calls findMany once per user.",
    suggestion: null,
    confidence: 0.86,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rv1",
    accepted_at: null,
    dismissed_at: null,
  },
] as FindingRecord[];

function Harness({
  counts,
  onRowClick,
  onOpenChange,
}: {
  counts: FindingsCounts;
  onRowClick?: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const label = useSeverityCountsLabel(counts);
  return (
    <div onClick={onRowClick}>
      <FindingsPopover
        label={label}
        title="2 findings in this run"
        findings={FINDINGS}
        delayMs={0}
        onOpenChange={onOpenChange}
      >
        <SeverityCounts counts={counts} />
      </FindingsPopover>
    </div>
  );
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const COUNTS: FindingsCounts = { CRITICAL: 1, WARNING: 2, SUGGESTION: 0 };
const TRIGGER = { name: "1 critical, 2 warnings" };

describe("SeverityCounts", () => {
  it("renders a chip per non-zero severity with its count", () => {
    renderWithIntl(<SeverityCounts counts={{ CRITICAL: 2, WARNING: 0, SUGGESTION: 5 }} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows — when there is nothing open to show", () => {
    renderWithIntl(<SeverityCounts counts={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    cleanup();
    renderWithIntl(<SeverityCounts counts={{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("FindingsPopover", () => {
  it("names the trigger by its non-zero counts", () => {
    renderWithIntl(<Harness counts={COUNTS} />);
    expect(screen.getByRole("button", TRIGGER)).toHaveAttribute("aria-expanded", "false");
  });

  it("hover opens the card with title, category, file:lines, confidence and rationale; leaving closes it", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithIntl(<Harness counts={COUNTS} onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole("button", TRIGGER);

    await user.hover(trigger);
    const card = screen.getByRole("dialog", { name: "2 findings in this run" });
    expect(card.parentElement).toBe(document.body); // portalled out of the row
    expect(screen.getByText("Hardcoded Stripe secret key in commit")).toBeInTheDocument();
    expect(screen.getByText("security")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:45-52")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
    expect(screen.getByText("98% conf")).toBeInTheDocument();
    expect(screen.getByText("The loop calls findMany once per user.")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    await user.unhover(trigger);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("tabbing to the trigger opens it and Escape closes it", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness counts={COUNTS} />);

    // The trigger is the only tabbable node in the harness.
    await user.tab();
    expect(screen.getByRole("button", TRIGGER)).toHaveFocus();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Enter toggles the card shut and open again", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness counts={COUNTS} />);

    await user.tab(); // focus opens it
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("the preview is read-only: no buttons or links in the card", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness counts={COUNTS} />);

    await user.tab();
    const card = screen.getByRole("dialog");
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
    expect(within(card).queryAllByRole("link")).toHaveLength(0);
  });

  it("clicks on the trigger or a finding never reach the row, and the card stays open", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    renderWithIntl(<Harness counts={COUNTS} onRowClick={onRowClick} />);
    const trigger = screen.getByRole("button", TRIGGER);

    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // fireEvent, deliberately: user.click would first move the pointer off the
    // trigger, and with delayMs={0} there is no grace period, so mouseleave
    // closes the card before the click could land. In the app delayMs is 150
    // and CLOSE_DELAY_MS keeps it open across that move. What is under test is
    // click-through (the row must not fire), not the pointer path.
    fireEvent.click(screen.getByText("N+1 query in user list endpoint"));

    expect(onRowClick).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
