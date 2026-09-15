/**
 * SeverityCounts + FindingsPopover — chips hide zero counts, the trigger has an
 * accessible summary, and the portalled card opens on hover/focus/Enter, closes
 * on leave/Escape, and never lets a click reach the surrounding row.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
  onSelectFinding,
  onOpenChange,
}: {
  counts: FindingsCounts;
  onRowClick?: () => void;
  onSelectFinding?: (f: FindingRecord) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const label = useSeverityCountsLabel(counts);
  return (
    <div onClick={onRowClick}>
      <FindingsPopover
        label={label}
        title="2 findings"
        findings={FINDINGS}
        delayMs={0}
        onOpenChange={onOpenChange}
        onSelectFinding={onSelectFinding}
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
    expect(screen.getByRole("button", { name: "1 critical, 2 warnings" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("hover opens the card with title, file:lines and confidence; leaving closes it", () => {
    const onOpenChange = vi.fn();
    renderWithIntl(<Harness counts={COUNTS} onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole("button", { name: "1 critical, 2 warnings" });

    fireEvent.mouseEnter(trigger);
    const card = screen.getByRole("dialog", { name: "2 findings" });
    expect(card.parentElement).toBe(document.body); // portalled out of the row
    expect(screen.getByText("Hardcoded Stripe secret key in commit")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:45-52")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
    expect(screen.getByText("98% conf")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("focus opens it and Escape closes it", () => {
    renderWithIntl(<Harness counts={COUNTS} />);
    fireEvent.focus(screen.getByRole("button", { name: "1 critical, 2 warnings" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clicks on the trigger or a finding never reach the row; a finding click selects it", () => {
    const onRowClick = vi.fn();
    const onSelectFinding = vi.fn();
    renderWithIntl(<Harness counts={COUNTS} onRowClick={onRowClick} onSelectFinding={onSelectFinding} />);
    const trigger = screen.getByRole("button", { name: "1 critical, 2 warnings" });

    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByText("N+1 query in user list endpoint"));

    expect(onRowClick).not.toHaveBeenCalled();
    expect(onSelectFinding).toHaveBeenCalledWith(expect.objectContaining({ id: "f2" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
