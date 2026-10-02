/**
 * OverviewTab — the PR Brief block was added above the intent card (spec
 * 0018), the intent card above the description (spec 0008), and the blast
 * radius card below it (spec 0012), so this pins that the description still
 * renders and the order is right.
 *
 * BlastRadiusCard is rendered for real, with only its data hook stubbed: the
 * props OverviewTab hands it are proved by what a user can see (a GitHub link
 * built from `repoFullName` + `headSha`), not by reading them back out of a
 * mock. Real messages go through `NextIntlClientProvider`, as in
 * `BlastRadiusCard.test.tsx`. `PrIntentCard` stays mocked — it belongs to
 * another feature and only its position (and, for AC-60, whether it renders
 * at all when its own endpoint has nothing) is under test here.
 *
 * `PrBriefBlock` is also rendered for real: its own hook (`@/lib/hooks/brief`)
 * is stubbed, so its wiring into this tab — position, the finished-review
 * props it needs for `VerdictBanner`, and that it renders no value from the
 * live cards' endpoints — is proved end to end.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadius, PrBriefEnvelope, PrBriefResponse } from "@/lib/types";
import messages from "../../../../../../../../messages/en/prReview.json";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import { OverviewTab } from "./OverviewTab";
import type { FinishedReviewSummary } from "../PrBriefBlock";

const blastData = vi.hoisted(() => ({ current: undefined as BlastRadius | undefined }));
const briefData = vi.hoisted(() => ({ current: { brief: null, stale: false } as PrBriefResponse }));
const generateMutate = vi.hoisted(() => vi.fn());
// Toggles whether the mocked PrIntentCard has anything to show — mirrors the
// REAL component's `if (!intent) return null` (PrIntentCard.tsx:28), so a
// "no data" fixture here proves the same thing a failed query would (AC-60).
const intentHasData = vi.hoisted(() => ({ current: true }));

vi.mock("@/lib/hooks/core", () => ({
  usePrBlast: () => ({ data: blastData.current, isLoading: false }),
}));
vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: () => ({ data: briefData.current }),
  useGenerateBrief: () => ({ mutate: generateMutate, isPending: false }),
}));
vi.mock("../PrIntentCard", () => ({
  PrIntentCard: ({ prId }: { prId: string | null }) =>
    intentHasData.current ? <div data-testid="intent-card">{prId ?? "no-pr"}</div> : null,
}));

const CALLER_FILE = "server/src/modules/pulls/routes.ts";

const blast: BlastRadius = {
  changed_symbols: [
    { name: "getContext", file: "server/src/modules/_shared/context.ts", kind: "function" },
  ],
  downstream: [
    {
      symbol: "getContext",
      file: "server/src/modules/_shared/context.ts",
      callers: [{ name: "handler", file: CALLER_FILE, line: 42 }],
      endpoints_affected: ["GET /pulls/:id"],
      crons_affected: [],
    },
  ],
  summary: "1 symbol · 1 caller · 1 endpoint · 0 crons",
};

// Sentinels absent from the live endpoints' own fixtures, so a leak of the
// brief's SNAPSHOT fields into the rendered output is unambiguous (AC-59).
const SNAPSHOT_INTENT_SENTINEL = "SNAPSHOT-ONLY-INTENT-overview";
const SNAPSHOT_BLAST_SENTINEL = "SNAPSHOT-ONLY-BLAST-overview";

function briefEnvelope(over: Partial<PrBriefEnvelope> = {}): PrBriefEnvelope {
  return {
    intent: { intent: SNAPSHOT_INTENT_SENTINEL, in_scope: [], out_of_scope: [] },
    blast: { changed_symbols: [], downstream: [], summary: SNAPSHOT_BLAST_SENTINEL },
    risks: { risks: [] },
    history: { history: [] },
    summary: "This PR tightens the rate limiter.",
    review_focus: [],
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

afterEach(cleanup);
beforeEach(() => {
  blastData.current = blast;
  briefData.current = { brief: null, stale: false };
  intentHasData.current = true;
  generateMutate.mockClear();
});

function renderTab(props: Partial<React.ComponentProps<typeof OverviewTab>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, brief: briefMessages }}>
      <OverviewTab
        prBody="Adds a readiness probe."
        prId="pr-1"
        repoFullName="acme/payments-api"
        headSha="abc123"
        finishedReview={null}
        onFocusFile={vi.fn()}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

/** True when `b` comes after `a` in document order. */
function isAfter(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("OverviewTab", () => {
  it("still renders the PR description", () => {
    renderTab();
    expect(screen.getByText("Adds a readiness probe.")).toBeInTheDocument();
  });

  it("renders the brief block, then the intent card, then the blast radius card, above the description", () => {
    renderTab({ prBody: "BODY TEXT" });

    // Each node is fetched with a throwing query, so a card that disappears
    // fails here. The old version compared `indexOf` on raw innerHTML, where a
    // missing card scored -1 and still "came first".
    const briefBlock = screen.getByText("PR Brief");
    const intent = screen.getByTestId("intent-card");
    const blastCard = screen.getByRole("region", { name: "Blast radius" });
    const body = screen.getByText("BODY TEXT");

    expect(isAfter(briefBlock, intent)).toBe(true);
    expect(isAfter(intent, blastCard)).toBe(true);
    expect(isAfter(blastCard, body)).toBe(true);
  });

  it("passes the pr id down to the intent card", () => {
    renderTab({ prId: "pr-42" });
    expect(screen.getByTestId("intent-card")).toHaveTextContent("pr-42");
  });

  /**
   * repoFullName and headSha reach BlastRadiusCard: the only place they surface
   * is the caller's GitHub link, so assert the href a user would follow. A
   * swapped or mistyped prop changes this URL.
   */
  it("passes repoFullName and headSha down to the blast radius card", async () => {
    const user = userEvent.setup();
    renderTab({ repoFullName: "acme/payments-api", headSha: "deadbeef" });

    await user.click(
      screen.getByRole("button", {
        name: "Show callers of getContext in server/src/modules/_shared/context.ts",
      }),
    );

    expect(screen.getByRole("link", { name: `${CALLER_FILE}:42` })).toHaveAttribute(
      "href",
      `https://github.com/acme/payments-api/blob/deadbeef/${CALLER_FILE}#L42`,
    );
  });

  /** No repo yet: the caller must read as text, never as a link to nowhere. */
  it("renders the caller as plain text when repoFullName has not loaded", async () => {
    const user = userEvent.setup();
    renderTab({ repoFullName: null, headSha: undefined });

    await user.click(
      screen.getByRole("button", {
        name: "Show callers of getContext in server/src/modules/_shared/context.ts",
      }),
    );

    expect(screen.getByText(`${CALLER_FILE}:42`)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: `${CALLER_FILE}:42` })).not.toBeInTheDocument();
  });

  /** A PR with no body is normal; the tab must not render an empty box. */
  it("omits the description section when there is no body", () => {
    renderTab({ prBody: null });
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
  });

  describe("PR Brief wiring (spec 0018)", () => {
    it("continues to render PrIntentCard and BlastRadiusCard alongside the brief block (AC-33)", () => {
      briefData.current = { brief: briefEnvelope(), stale: false };
      renderTab();
      expect(screen.getByTestId("intent-card")).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Blast radius" })).toBeInTheDocument();
    });

    it("renders VerdictBanner with the brief's summary when a finished review exists (AC-39)", () => {
      briefData.current = { brief: briefEnvelope({ summary: "Reviewed-PR summary." }), stale: false };
      renderTab({ finishedReview: REVIEWED });
      expect(screen.getByText("Request changes")).toBeInTheDocument();
      expect(screen.getAllByText("Reviewed-PR summary.")).toHaveLength(1);
    });

    it("renders no VerdictBanner while the pull request has no finished review (AC-49)", () => {
      briefData.current = { brief: briefEnvelope({ summary: "Unreviewed-PR summary." }), stale: false };
      renderTab({ finishedReview: null });
      expect(screen.queryByText("Request changes")).not.toBeInTheDocument();
      expect(screen.getAllByText("Unreviewed-PR summary.")).toHaveLength(1);
    });

    /**
     * Both live cards stubbed to have nothing, with a brief present. Neither
     * card has an error state — both `return null` on absent data by design
     * (`PrIntentCard.tsx:28`, `BlastRadiusCard.tsx:71`) — so the only testable
     * claim is their absence, and that no snapshot-only sentinel leaks out
     * anywhere (AC-60, AC-59).
     */
    it("renders neither live card when their own endpoints have nothing, and no snapshot sentinel anywhere (AC-60)", () => {
      intentHasData.current = false;
      blastData.current = undefined;
      briefData.current = { brief: briefEnvelope(), stale: false };
      renderTab();
      expect(screen.queryByTestId("intent-card")).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Blast radius" })).not.toBeInTheDocument();
      expect(screen.queryByText(SNAPSHOT_INTENT_SENTINEL)).not.toBeInTheDocument();
      expect(screen.queryByText(SNAPSHOT_BLAST_SENTINEL)).not.toBeInTheDocument();
    });
  });
});
