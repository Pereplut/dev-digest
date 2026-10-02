/**
 * PrBriefBlock (spec 0018).
 *
 * Covers: the four read states (null, generated, stale, busy), the
 * render-once rule for `summary` (AC-28/AC-39/AC-49 — the seeded PR has a
 * finished review, so this is the state a real run actually sees), the
 * missing-inputs message, the risk disclosure, the review-focus deep link,
 * and that the block never renders a value taken from `intent`/`blast`/
 * `history` (AC-59).
 *
 * Only the data hooks are mocked (`@/lib/hooks/brief`) — never `fetch` — per
 * `client/AGENTS.md`.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { PrBriefEnvelope, PrBriefResponse } from "@/lib/types";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import { PrBriefBlock, type FinishedReviewSummary } from "./PrBriefBlock";

const briefState = vi.hoisted(() => ({
  current: { brief: null, stale: false } as PrBriefResponse | undefined,
  isLoading: false,
}));
const generateState = vi.hoisted(() => ({ isPending: false }));
const generateMutate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: () => ({ data: briefState.current, isLoading: briefState.isLoading }),
  useGenerateBrief: () => ({ mutate: generateMutate, isPending: generateState.isPending }),
}));

afterEach(cleanup);
beforeEach(() => {
  briefState.current = { brief: null, stale: false };
  briefState.isLoading = false;
  generateState.isPending = false;
  generateMutate.mockClear();
});

// Sentinels absent from anywhere else in the fixture, so a leak from `intent`
// or `blast` into the rendered output is unambiguous (AC-59).
const SNAPSHOT_INTENT_SENTINEL = "SNAPSHOT-ONLY-INTENT-9f3a";
const SNAPSHOT_BLAST_SENTINEL = "SNAPSHOT-ONLY-BLAST-9f3a";

function brief(over: Partial<PrBriefEnvelope> = {}): PrBriefEnvelope {
  return {
    intent: { intent: SNAPSHOT_INTENT_SENTINEL, in_scope: [], out_of_scope: [] },
    blast: { changed_symbols: [], downstream: [], summary: SNAPSHOT_BLAST_SENTINEL },
    risks: {
      risks: [
        {
          kind: "security",
          title: "Rate limiter bypass",
          explanation: "A missing check lets an attacker skip the limiter.",
          severity: "high",
          file_refs: ["src/middleware/ratelimit.ts"],
        },
        {
          kind: "correctness",
          title: "Off-by-one in retry count",
          explanation: "The loop runs one fewer time than intended.",
          severity: "low",
          file_refs: ["src/api/users.ts"],
        },
      ],
    },
    history: { history: [] },
    summary: "Tightens the rate limiter and fixes a retry off-by-one.",
    review_focus: [
      { file: "src/middleware/ratelimit.ts", line: 10, reason: "Entry point for the new check." },
      { file: "src/api/users.ts", line: 42, reason: "The off-by-one lives here." },
    ],
    head_sha: "abc123",
    generated_at: "2026-01-01T00:00:00Z",
    model: "test-model",
    missing_inputs: [],
    ...over,
  };
}

const REVIEWED: FinishedReviewSummary = {
  verdict: "request_changes",
  score: 61,
  findingsCount: 3,
  blockers: 1,
  agentName: "Security Reviewer",
};

function renderBlock(props: Partial<React.ComponentProps<typeof PrBriefBlock>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages, prReview: prReviewMessages }}>
      <PrBriefBlock
        prId="pr-1"
        finishedReview={null}
        onFocusFile={vi.fn()}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("PrBriefBlock — no brief yet", () => {
  it("renders a Generate control and no lists (AC-26)", () => {
    renderBlock();
    expect(screen.getByRole("button", { name: "Generate brief" })).toBeInTheDocument();
    expect(screen.queryByText("Risk areas")).not.toBeInTheDocument();
    expect(screen.queryByText("Review focus — read these first")).not.toBeInTheDocument();
  });

  it("issues exactly one generate call when activated (AC-27)", async () => {
    const user = userEvent.setup();
    renderBlock();
    await user.click(screen.getByRole("button", { name: "Generate brief" }));
    expect(generateMutate).toHaveBeenCalledTimes(1);
  });

  it("disables the control while a generation is in flight, blocking a second click (AC-27)", async () => {
    const user = userEvent.setup();
    generateState.isPending = true;
    renderBlock();
    const busyButton = screen.getByRole("button", { name: "Generating…" });
    expect(busyButton).toBeDisabled();
    await user.click(busyButton);
    expect(generateMutate).not.toHaveBeenCalled();
  });

  it("mounts without ever calling generate on its own (AC-34)", () => {
    renderBlock();
    expect(generateMutate).not.toHaveBeenCalled();
  });

  it("never offers Generate while the cached brief is still loading (AC-34)", async () => {
    // The regression this pins: reading only `data` left `brief` null during
    // the in-flight GET, so the control rendered "Generate brief" ENABLED on a
    // PR that already had one — and a click there spends a model call, which
    // is exactly what AC-34 forbids. Found by review, not by a test, because
    // every other case here stubs the hook to resolve synchronously.
    briefState.current = undefined;
    briefState.isLoading = true;
    const user = userEvent.setup();
    renderBlock();

    expect(screen.queryByRole("button", { name: "Generate brief" })).not.toBeInTheDocument();
    const control = screen.getByRole("button", { name: /Loading/ });
    expect(control).toBeDisabled();

    await user.click(control);
    expect(generateMutate).not.toHaveBeenCalled();
  });
});

describe("PrBriefBlock — brief present, no finished review", () => {
  beforeEach(() => {
    briefState.current = { brief: brief(), stale: false };
  });

  it("renders the summary as a paragraph exactly once, and no VerdictBanner (AC-28, AC-49)", () => {
    renderBlock({ finishedReview: null });
    const matches = screen.getAllByText("Tightens the rate limiter and fixes a retry off-by-one.");
    expect(matches).toHaveLength(1);
    expect(screen.queryByText("Request changes")).not.toBeInTheDocument();
  });

  it("renders one row per risk, each with a title and a file ref (AC-29)", () => {
    renderBlock();
    expect(screen.getByText("Rate limiter bypass")).toBeInTheDocument();
    expect(screen.getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
    expect(screen.getByText("Off-by-one in retry count")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts")).toBeInTheDocument();
  });

  it("renders every risk's severity band spelled out in text (AC-37)", () => {
    renderBlock();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument();
  });

  it("renders every review-focus row with file, line and reason, in envelope order (AC-30)", () => {
    renderBlock();
    const rows = screen.getAllByRole("button", { name: /src\// });
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("src/middleware/ratelimit.ts:10"),
      expect.stringContaining("src/api/users.ts:42"),
    ]);
    expect(screen.getByText("Entry point for the new check.")).toBeInTheDocument();
    expect(screen.getByText("The off-by-one lives here.")).toBeInTheDocument();
  });

  it("renders no cap of its own over 8 risks and 9 review-focus items (AC-51)", () => {
    const manyRisks = Array.from({ length: 8 }, (_, i) => ({
      kind: "security",
      title: `Risk ${i}`,
      explanation: "e",
      severity: "low" as const,
      file_refs: [`src/f${i}.ts`],
    }));
    const manyFocus = Array.from({ length: 9 }, (_, i) => ({
      file: `src/f${i}.ts`,
      line: i + 1,
      reason: `reason ${i}`,
    }));
    briefState.current = { brief: brief({ risks: { risks: manyRisks }, review_focus: manyFocus }), stale: false };
    renderBlock();
    for (let i = 0; i < 8; i++) expect(screen.getByText(`Risk ${i}`)).toBeInTheDocument();
    for (let i = 0; i < 9; i++) expect(screen.getByText(`reason ${i}`)).toBeInTheDocument();
  });

  it("collapses risk explanations and reveals them on activation, tracking aria-expanded (AC-38)", async () => {
    const user = userEvent.setup();
    renderBlock();
    const header = screen.getByRole("button", { name: /Rate limiter bypass/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByText("A missing check lets an attacker skip the limiter."),
    ).not.toBeInTheDocument();

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText("A missing check lets an attacker skip the limiter."),
    ).toBeInTheDocument();
  });

  it("activating a review-focus row calls back with that file (AC-42)", async () => {
    const user = userEvent.setup();
    const onFocusFile = vi.fn();
    renderBlock({ onFocusFile });
    await user.click(screen.getByRole("button", { name: /src\/middleware\/ratelimit\.ts/ }));
    expect(onFocusFile).toHaveBeenCalledWith("src/middleware/ratelimit.ts");
  });

  it("renders no value taken from intent or blast (AC-59)", () => {
    renderBlock();
    expect(screen.queryByText(SNAPSHOT_INTENT_SENTINEL)).not.toBeInTheDocument();
    expect(screen.queryByText(SNAPSHOT_BLAST_SENTINEL)).not.toBeInTheDocument();
  });

  it("the refresh control sits in the SectionLabel right slot, not inside a banner (AC-53)", () => {
    renderBlock();
    const heading = screen.getByText("PR Brief");
    const sectionLabelRow = heading.closest("div");
    expect(within(sectionLabelRow as HTMLElement).getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("refresh replaces the rendered brief with the response (AC-35)", async () => {
    const user = userEvent.setup();
    const refreshed = brief({ summary: "A brand-new summary after refresh." });
    generateMutate.mockImplementation(() => {
      briefState.current = { brief: refreshed, stale: false };
    });
    const { rerender } = renderBlock();
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(generateMutate).toHaveBeenCalledTimes(1);
    rerender(
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages, prReview: prReviewMessages }}>
        <PrBriefBlock prId="pr-1" finishedReview={null} onFocusFile={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("A brand-new summary after refresh.")).toBeInTheDocument();
  });
});

describe("PrBriefBlock — brief present, a finished review exists", () => {
  beforeEach(() => {
    briefState.current = { brief: brief(), stale: false };
  });

  it("renders the summary inside VerdictBanner exactly once, and no block paragraph (AC-28, AC-39)", () => {
    renderBlock({ finishedReview: REVIEWED });
    const matches = screen.getAllByText("Tightens the rate limiter and fixes a retry off-by-one.");
    expect(matches).toHaveLength(1);
    // VerdictBanner is on screen (its own verdict label proves it, not the block's own copy).
    expect(screen.getByText("Request changes")).toBeInTheDocument();
  });
});

describe("PrBriefBlock — empty lists", () => {
  it("renders the noRisks message instead of an empty list (AC-31)", () => {
    briefState.current = { brief: brief({ risks: { risks: [] } }), stale: false };
    renderBlock();
    expect(screen.getByText("No risks identified.")).toBeInTheDocument();
  });

  it("renders no REVIEW FOCUS heading, badge or list when review_focus is empty (AC-55)", () => {
    briefState.current = { brief: brief({ review_focus: [] }), stale: false };
    renderBlock();
    expect(screen.queryByText("Review focus — read these first")).not.toBeInTheDocument();
  });
});

describe("PrBriefBlock — missing inputs", () => {
  it("names each missing input, appending its reason where present (AC-32)", () => {
    briefState.current = {
      brief: brief({
        missing_inputs: [{ input: "intent" }, { input: "blast", reason: "no_data" }],
      }),
      stale: false,
    };
    renderBlock();
    expect(screen.getByText("Generated without PR intent")).toBeInTheDocument();
    expect(screen.getByText("Generated without Blast radius (no_data)")).toBeInTheDocument();
  });

  it("renders nothing when missing_inputs is empty", () => {
    briefState.current = { brief: brief({ missing_inputs: [] }), stale: false };
    renderBlock();
    expect(screen.queryByText(/^Generated without/)).not.toBeInTheDocument();
  });
});

describe("PrBriefBlock — staleness", () => {
  it("renders an out-of-date hint beside refresh when stale (AC-36)", () => {
    briefState.current = { brief: brief(), stale: true };
    renderBlock();
    expect(screen.getByText("Out of date — the PR has new commits")).toBeInTheDocument();
  });

  it("renders no hint when not stale", () => {
    briefState.current = { brief: brief(), stale: false };
    renderBlock();
    expect(screen.queryByText("Out of date — the PR has new commits")).not.toBeInTheDocument();
  });
});

describe("PrBriefBlock — busy", () => {
  it("shows the busy label on a disabled control and a Skeleton instead of the lists (AC-54)", () => {
    briefState.current = { brief: brief(), stale: false };
    generateState.isPending = true;
    const { container } = renderBlock();
    expect(screen.getByRole("button", { name: "Generating…" })).toBeDisabled();
    expect(screen.queryByText("Rate limiter bypass")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  });
});

describe("PrBriefBlock — i18n", () => {
  it("renders no literal string when the brief namespace is missing", () => {
    briefState.current = { brief: brief(), stale: false };
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages }}>
        <PrBriefBlock prId="pr-1" finishedReview={null} onFocusFile={vi.fn()} />
      </NextIntlClientProvider>,
    );
    // next-intl marks a missing message rather than silently falling back to
    // hardcoded English, so "Generate brief" (the literal we'd see if the
    // copy were hardcoded) must be ABSENT.
    expect(screen.queryByText("Generate brief")).not.toBeInTheDocument();
  });
});
