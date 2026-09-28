/**
 * BlastRadiusCard (spec 0012) — which callers and HTTP endpoints/cron jobs a
 * PR's changed symbols reach, read from a finished repo-intel index.
 *
 * Real messages (`messages/en/prReview.json`) go through `NextIntlClientProvider`
 * so assertions read against the copy that ships, the way DiffTab.test.tsx does.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadius } from "@/lib/types";
import messages from "../../../../../../../../messages/en/prReview.json";
import { BlastRadiusCard } from "./BlastRadiusCard";

const blastData = vi.hoisted(() => ({
  current: undefined as BlastRadius | undefined,
  loading: false,
}));

vi.mock("@/lib/hooks/core", () => ({
  usePrBlast: () => ({ data: blastData.current, isLoading: blastData.loading }),
}));

afterEach(cleanup);
beforeEach(() => {
  blastData.current = undefined;
  blastData.loading = false;
});

function renderCard(props: Partial<React.ComponentProps<typeof BlastRadiusCard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <BlastRadiusCard
        prId="pr-1"
        repoFullName="acme/payments-api"
        headSha="deadbeef"
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

const populated: BlastRadius = {
  changed_symbols: [
    { name: "getContext", file: "server/src/modules/_shared/context.ts", kind: "function" },
    { name: "unusedHelper", file: "server/src/modules/_shared/helpers.ts", kind: "function" },
  ],
  downstream: [
    {
      symbol: "getContext",
      callers: [
        { name: "handler", file: "server/src/modules/pulls/routes.ts", line: 42 },
        { name: "handler2", file: "server/src/modules/repos/routes.ts", line: 17 },
      ],
      endpoints_affected: ["GET /pulls/:id", "GET /repos/:id"],
      crons_affected: [],
    },
  ],
  summary: "2 symbols · 2 callers · 2 endpoints · 0 crons",
};

describe("BlastRadiusCard", () => {
  it("shows skeleton rows while isLoading, and nothing from the callers tree", () => {
    blastData.loading = true;
    renderCard();
    expect(screen.getByRole("status", { name: "Reading the code index…" })).toBeInTheDocument();
    expect(screen.queryByText("getContext")).not.toBeInTheDocument();
  });

  it("renders nothing when there is no data (error path)", () => {
    blastData.current = undefined;
    blastData.loading = false;
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the summary chips and one row per changed symbol", () => {
    blastData.current = populated;
    renderCard();
    expect(screen.getByText("2 changed symbols")).toBeInTheDocument();
    expect(screen.getByText("2 callers")).toBeInTheDocument();
    expect(screen.getByText("2 endpoints")).toBeInTheDocument();
    expect(screen.getByText("0 cron jobs")).toBeInTheDocument();
    expect(screen.getByText("getContext")).toBeInTheDocument();
    // A changed symbol with no downstream entry gets the no-callers note, not a toggle.
    expect(screen.getByText("unusedHelper")).toBeInTheDocument();
    expect(screen.getByText("No caller outside its own file")).toBeInTheDocument();
  });

  it("expands a symbol by its EXACT accessible name and reveals its callers", async () => {
    blastData.current = populated;
    const user = userEvent.setup();
    renderCard();

    const toggle = screen.getByRole("button", { name: "Show callers of getContext" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("server/src/modules/pulls/routes.ts:42")).not.toBeInTheDocument();

    await user.click(toggle);

    expect(screen.getByRole("button", { name: "Hide callers of getContext" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("server/src/modules/pulls/routes.ts:42")).toBeInTheDocument();
    expect(screen.getByText("GET /pulls/:id")).toBeInTheDocument();
  });

  it("links a caller's file:line to GitHub pinned to the PR head sha", async () => {
    blastData.current = populated;
    const user = userEvent.setup();
    renderCard({ repoFullName: "acme/payments-api", headSha: "deadbeef" });

    await user.click(screen.getByRole("button", { name: "Show callers of getContext" }));

    const link = screen.getByRole("link", { name: "server/src/modules/pulls/routes.ts:42" });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/deadbeef/server/src/modules/pulls/routes.ts#L42",
    );
  });

  it("renders plain text, never a broken link, when repoFullName is null", async () => {
    blastData.current = populated;
    const user = userEvent.setup();
    renderCard({ repoFullName: null, headSha: "deadbeef" });

    await user.click(screen.getByRole("button", { name: "Show callers of getContext" }));

    expect(
      screen.queryByRole("link", { name: "server/src/modules/pulls/routes.ts:42" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("server/src/modules/pulls/routes.ts:42")).toBeInTheDocument();
  });

  it("shows an EmptyState with the empty copy when nothing is downstream", () => {
    blastData.current = {
      changed_symbols: [{ name: "onlyLocal", file: "server/src/x.ts", kind: "function" }],
      downstream: [],
      summary: "1 symbol · 0 callers · 0 endpoints · 0 crons",
    };
    renderCard();
    expect(screen.getByText("Nothing downstream")).toBeInTheDocument();
    expect(
      screen.getByText(/No file outside this PR references the symbols it changes/),
    ).toBeInTheDocument();
  });

  it("marks a degraded map with a role=status naming the reason, above the data returned", () => {
    blastData.current = { ...populated, degraded: true, reason: "index_partial" };
    renderCard();
    const marker = screen.getByRole("status", {
      name: "Partial map — This repository is only partly indexed, so callers are missing.",
    });
    expect(marker).toHaveTextContent("Partial map");
    expect(marker).toHaveTextContent(
      "This repository is only partly indexed, so callers are missing.",
    );
    // Data still renders beneath the marker.
    expect(screen.getByText("getContext")).toBeInTheDocument();
  });

  it("falls back to the no_data sentence for an unrecognised reason", () => {
    blastData.current = { ...populated, degraded: true, reason: "something_new" };
    renderCard();
    expect(
      screen.getByText("This repository has not been indexed yet, so there is nothing to read."),
    ).toBeInTheDocument();
  });

  /**
   * `capped` is server-truth (spec 0012): the client cannot tell a symbol with
   * exactly 20 real callers from one that was actually truncated, so the note
   * must render only when the server says so — never from a client-side
   * `callers.length >= 20` comparison.
   */
  it("shows the capped note when the server reports capped: true", async () => {
    const user = userEvent.setup();
    blastData.current = {
      ...populated,
      downstream: [{ ...populated.downstream[0]!, capped: true }],
    };
    renderCard();
    await user.click(screen.getByRole("button", { name: "Show callers of getContext" }));
    expect(screen.getByText("Showing the 20 highest-ranked callers")).toBeInTheDocument();
  });

  it("does not show the capped note for exactly 20 callers when the server did not report capped", async () => {
    const user = userEvent.setup();
    const twentyCallers = Array.from({ length: 20 }, (_, i) => ({
      name: `handler${i}`,
      file: `server/src/modules/x/routes${i}.ts`,
      line: i + 1,
    }));
    blastData.current = {
      ...populated,
      downstream: [{ ...populated.downstream[0]!, callers: twentyCallers, capped: undefined }],
    };
    renderCard();
    await user.click(screen.getByRole("button", { name: "Show callers of getContext" }));
    expect(screen.queryByText("Showing the 20 highest-ranked callers")).not.toBeInTheDocument();
  });
});
