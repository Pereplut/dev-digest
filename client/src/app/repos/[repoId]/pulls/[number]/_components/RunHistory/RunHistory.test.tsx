/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring. A run matched to its review shows open
 * finding chips with a hover card; an unmatched run keeps the text line.
 *
 * The popover interactions below deliberately stay on fireEvent. RunHistory
 * renders FindingsPopover with its DEFAULT delayMs (150), so focusing the
 * trigger schedules an open on a timer (FindingsPopover.tsx:82-86,137) while
 * Enter toggles (FindingsPopover.tsx:140-147). user-event's click/tab fire real
 * focus events, so focus-then-Enter races that timer: whether Enter opens or
 * closes the card depends on wall-clock timing. fireEvent dispatches the
 * keydown alone, which is deterministic. The popover's own hover/focus/Escape
 * behaviour is covered in components/findings-summary/FindingsPopover.test.tsx,
 * whose harness passes delayMs={0}.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: null,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

function renderRuns(
  runs: RunSummary[],
  opts: { reviews?: ReviewRecord[]; onGoToReview?: (runId: string) => void } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} reviews={opts.reviews} onGoToReview={opts.onGoToReview} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

function finding(id: string, severity: string, title: string, dismissed = false) {
  return {
    id,
    severity,
    category: "perf",
    title,
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 52,
    rationale: "r",
    suggestion: null,
    confidence: 0.86,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rv1",
    accepted_at: null,
    dismissed_at: dismissed ? "2026-09-15T10:00:00Z" : null,
  };
}

function reviewFor(runId: string, findings: ReturnType<typeof finding>[]): ReviewRecord {
  return {
    id: `rv-${runId}`,
    pr_id: "pr-1",
    agent_id: "a1",
    run_id: runId,
    kind: "review",
    verdict: "request_changes",
    summary: null,
    score: 38,
    model: null,
    created_at: "2026-06-11T18:44:40.000Z",
    findings,
  } as unknown as ReviewRecord;
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("RunHistory — run cost under the start time", () => {
  it("a done run shows its cost", () => {
    renderRuns([run({ status: "done", cost_usd: 0.0149, score: 61 })]);
    expect(screen.getByText("$0.015")).toBeInTheDocument();
  });

  it("a done run without a price shows —, never $0.00", () => {
    renderRuns([run({ status: "done", cost_usd: null, score: 61 })]);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("an unfinished run shows no price", () => {
    renderRuns([
      run({ run_id: "f", status: "failed", error: "boom", cost_usd: 0.5 }),
      run({ run_id: "r", status: "running", cost_usd: 0.5 }),
    ]);
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});

describe("RunHistory — finding chips", () => {
  const reviews = [
    reviewFor("run-1", [
      finding("f1", "CRITICAL", "Hardcoded Stripe secret key in commit"),
      finding("f2", "SUGGESTION", "Extract magic number 3600"),
      finding("f3", "WARNING", "Dismissed warning", true),
    ]),
  ];

  it("a run matched to its review shows open-finding chips + blockers, with a hover card", () => {
    renderRuns([run({ findings_count: 3, blockers: 1, score: 38 })], { reviews });
    const trigger = screen.getByRole("button", { name: "1 critical, 1 suggestion" });
    expect(trigger).toHaveTextContent("· 1 blockers");
    expect(screen.queryByText(/finding\(s\)/)).not.toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "2 findings in this run" })).toBeInTheDocument();
    expect(screen.getByText("Extract magic number 3600")).toBeInTheDocument();
    expect(screen.queryByText("Dismissed warning")).not.toBeInTheDocument();
  });

  it("the chips and their card are read-only: no buttons, and clicking a finding doesn't navigate", () => {
    const onGoToReview = vi.fn();
    renderRuns([run({ findings_count: 3, blockers: 1, score: 38 })], { reviews, onGoToReview });
    const trigger = screen.getByRole("button", { name: "1 critical, 1 suggestion" });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Enter" });
    const card = screen.getByRole("dialog", { name: "2 findings in this run" });
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
    fireEvent.click(screen.getByText("Hardcoded Stripe secret key in commit"));
    expect(onGoToReview).not.toHaveBeenCalled();
  });

  it("a run without a matched review keeps the text line from the run row", () => {
    renderRuns([run({ run_id: "run-2", findings_count: 3, blockers: 0, score: 72 })], { reviews });
    expect(screen.getByText("3 finding(s)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /critical|warning|suggestion/ })).not.toBeInTheDocument();
  });

  it("a review whose findings were all dismissed reads 0 finding(s)", () => {
    renderRuns([run({ findings_count: 1, score: 88 })], {
      reviews: [reviewFor("run-1", [finding("f9", "WARNING", "Gone", true)])],
    });
    expect(screen.getByText("0 finding(s)")).toBeInTheDocument();
  });
});
