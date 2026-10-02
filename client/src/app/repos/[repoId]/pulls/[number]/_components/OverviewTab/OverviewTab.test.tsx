/**
 * OverviewTab — the intent card was added above the description (spec 0008) and
 * the blast radius card below it (spec 0012), so this pins that the description
 * still renders and the order is right.
 *
 * BlastRadiusCard is rendered for real, with only its data hook stubbed: the
 * props OverviewTab hands it are proved by what a user can see (a GitHub link
 * built from `repoFullName` + `headSha`), not by reading them back out of a
 * mock. Real messages go through `NextIntlClientProvider`, as in
 * `BlastRadiusCard.test.tsx`. `PrIntentCard` stays mocked — it belongs to
 * another feature and only its position is under test here.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadius } from "@/lib/types";
import messages from "../../../../../../../../messages/en/prReview.json";
import { OverviewTab } from "./OverviewTab";

const blastData = vi.hoisted(() => ({ current: undefined as BlastRadius | undefined }));

vi.mock("@/lib/hooks/core", () => ({
  usePrBlast: () => ({ data: blastData.current, isLoading: false }),
}));
vi.mock("../PrIntentCard", () => ({
  PrIntentCard: ({ prId }: { prId: string | null }) => (
    <div data-testid="intent-card">{prId ?? "no-pr"}</div>
  ),
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

afterEach(cleanup);
beforeEach(() => {
  blastData.current = blast;
});

function renderTab(props: Partial<React.ComponentProps<typeof OverviewTab>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <OverviewTab
        prBody="Adds a readiness probe."
        prId="pr-1"
        repoFullName="acme/payments-api"
        headSha="abc123"
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

  it("renders the intent card, then the blast radius card, above the description", () => {
    renderTab({ prBody: "BODY TEXT" });

    // Each node is fetched with a throwing query, so a card that disappears
    // fails here. The old version compared `indexOf` on raw innerHTML, where a
    // missing card scored -1 and still "came first".
    const intent = screen.getByTestId("intent-card");
    const blastCard = screen.getByRole("region", { name: "Blast radius" });
    const body = screen.getByText("BODY TEXT");

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
});
