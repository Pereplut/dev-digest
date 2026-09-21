/**
 * PRRow — the COST column shows the total cost of the PR's successful runs:
 * exact, "≥" when some done run has no price, and "—" when nothing is priced.
 * The FINDINGS column shows the open finding counts of the latest run with a
 * review; its popover ("N findings in this run") lists exactly those findings,
 * read-only, and never triggers the row navigation.
 *
 * The popover interactions below deliberately stay on fireEvent. PRRow renders
 * FindingsPopover with its DEFAULT delayMs (150), so focusing the trigger
 * schedules an open on a timer (FindingsPopover.tsx:82-86,137) while Enter
 * toggles (FindingsPopover.tsx:140-147). user-event's click/tab fire real focus
 * events, so focus-then-Enter races that timer: whether Enter opens or closes
 * the card depends on wall-clock timing. fireEvent dispatches the keydown
 * alone, which is deterministic. The popover's own hover/focus/Escape behaviour
 * is covered in components/findings-summary/FindingsPopover.test.tsx, whose
 * harness passes delayMs={0}.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

let reviewsData: ReviewRecord[] | undefined;
const reviewsCalls: (string | null | undefined)[] = [];
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: (prId: string | null | undefined) => {
    reviewsCalls.push(prId);
    return { data: prId ? reviewsData : undefined };
  },
}));

import { PRRow } from "./PRRow";

afterEach(() => {
  cleanup();
  push.mockClear();
  reviewsCalls.length = 0;
  reviewsData = undefined;
});

function pr(o: Partial<PrMeta>): PrMeta {
  return {
    id: "pr-1",
    number: 482,
    title: "Add rate limiting to public API endpoints",
    author: "marisa.koch",
    branch: "feat/rate-limit-public",
    base: "main",
    head_sha: "a1b2c3",
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: "reviewed",
    opened_at: null,
    updated_at: new Date().toISOString(),
    score: 61,
    cost_usd: null,
    cost_complete: null,
    findings_counts: { CRITICAL: 1, WARNING: 0, SUGGESTION: 0 },
    findings_run_id: "run-1",
    ...o,
  };
}

function renderRow(p: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={p} repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

function finding(id: string, severity: string, title: string, dismissed = false) {
  return {
    id,
    severity,
    category: "security",
    title,
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "r",
    suggestion: null,
    confidence: 0.98,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rv",
    accepted_at: null,
    dismissed_at: dismissed ? "2026-09-15T10:00:00Z" : null,
  };
}

describe("PRRow — COST column", () => {
  it("shows the total cost of successful runs", () => {
    renderRow(pr({ cost_usd: 0.014, cost_complete: true }));
    expect(screen.getByText("$0.014")).toBeInTheDocument();
  });

  it("marks a partial total with ≥ and explains it in a tooltip", () => {
    renderRow(pr({ cost_usd: 0.014, cost_complete: false }));
    expect(screen.getByText("≥$0.014")).toHaveAttribute("title", messages.list.costPartial);
  });

  it("shows — when no run is priced, never $0.00", () => {
    renderRow(pr({ cost_usd: null, cost_complete: null }));
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});

describe("PRRow — FINDINGS column", () => {
  it("shows chips for non-zero severities, named by their counts", () => {
    renderRow(pr({ cost_usd: 0.014, findings_counts: { CRITICAL: 2, WARNING: 0, SUGGESTION: 3 } }));
    const trigger = screen.getByRole("button", { name: "2 critical, 3 suggestions" });
    expect(trigger).toHaveTextContent("2");
    expect(trigger).toHaveTextContent("3");
    // reviews aren't fetched until the popover opens
    expect(reviewsCalls.every((id) => id == null)).toBe(true);
  });

  it("shows — without a popover when the run has no open findings or there is no reviewed run", () => {
    renderRow(pr({ cost_usd: 0.014, findings_counts: null, findings_run_id: null }));
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /critical|warning|suggestion/ })).not.toBeInTheDocument();
    cleanup();
    renderRow(pr({ cost_usd: 0.014, findings_counts: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 } }));
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("opening the popover fetches reviews and lists only that run's open findings", () => {
    reviewsData = [
      {
        id: "rv1", pr_id: "pr-1", agent_id: "a1", run_id: "run-1", kind: "review", verdict: "request_changes",
        summary: null, score: 61, model: null, created_at: "2026-09-15T10:00:00Z",
        findings: [
          finding("f1", "CRITICAL", "Hardcoded Stripe secret key in commit"),
          finding("f2", "WARNING", "Dismissed warning", true),
        ],
      },
      {
        id: "rv0", pr_id: "pr-1", agent_id: "a1", run_id: "run-old", kind: "review", verdict: "comment",
        summary: null, score: 70, model: null, created_at: "2026-09-14T10:00:00Z",
        findings: [finding("f0", "CRITICAL", "Finding from an older run")],
      },
    ] as unknown as ReviewRecord[];
    renderRow(pr({}));

    fireEvent.keyDown(screen.getByRole("button", { name: "1 critical" }), { key: "Enter" });

    expect(reviewsCalls).toContain("pr-1");
    expect(screen.getByRole("dialog", { name: "1 finding in this run" })).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key in commit")).toBeInTheDocument();
    expect(screen.queryByText("Dismissed warning")).not.toBeInTheDocument();
    expect(screen.queryByText("Finding from an older run")).not.toBeInTheDocument();
  });

  it("the preview is read-only: clicking chips or a finding never navigates, and the card has no buttons", () => {
    reviewsData = [
      {
        id: "rv1", pr_id: "pr-1", agent_id: "a1", run_id: "run-1", kind: "review", verdict: "request_changes",
        summary: null, score: 61, model: null, created_at: "2026-09-15T10:00:00Z",
        findings: [finding("f1", "CRITICAL", "Hardcoded Stripe secret key in commit")],
      },
    ] as unknown as ReviewRecord[];
    renderRow(pr({}));
    const trigger = screen.getByRole("button", { name: "1 critical" });

    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Enter" });
    const card = screen.getByRole("dialog", { name: "1 finding in this run" });
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
    fireEvent.click(screen.getByText("Hardcoded Stripe secret key in commit"));
    expect(push).not.toHaveBeenCalled();
  });
});

describe("PRRow — navigation", () => {
  it("clicking the title link does not also run the row's router.push", async () => {
    const user = userEvent.setup();
    renderRow(pr({}));
    const link = screen.getByRole("link", { name: "Add rate limiting to public API endpoints" });
    expect(link).toHaveAttribute("href", "/repos/repo-1/pulls/482");
    // jsdom does not navigate on an anchor click; stop it logging "not implemented".
    link.addEventListener("click", (e) => e.preventDefault());

    await user.click(link);
    expect(push).not.toHaveBeenCalled();

    await user.click(screen.getByText("marisa.koch"));
    expect(push).toHaveBeenCalledWith("/repos/repo-1/pulls/482");
  });
});
