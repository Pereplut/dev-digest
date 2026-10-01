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

const CONTEXT_FILE = "server/src/modules/_shared/context.ts";

const populated: BlastRadius = {
  changed_symbols: [
    { name: "getContext", file: CONTEXT_FILE, kind: "function" },
    { name: "unusedHelper", file: "server/src/modules/_shared/helpers.ts", kind: "function" },
  ],
  downstream: [
    {
      symbol: "getContext",
      file: CONTEXT_FILE,
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

/**
 * Two changed symbols sharing a NAME but declared in different files (spec
 * 0012 aliasing fix). `downstream[*].file` is what tells them apart — and
 * since `blast.expandSymbol`/`blast.collapseSymbol` interpolate the file as
 * well as the symbol name, the two rows now have distinct accessible names
 * ("Show callers of getContext in server/src/modules/a/context.ts" vs
 * "…/b/context.ts"), a real a11y requirement and not just a test
 * convenience: two same-named rows with the same visible text and the same
 * accessible name would be indistinguishable to a screen-reader user. The
 * regression test below queries each row by its own unique accessible name,
 * re-querying from `screen` after each click rather than holding a stale
 * element reference.
 */
const sameNamePopulated: BlastRadius = {
  changed_symbols: [
    { name: "getContext", file: "server/src/modules/a/context.ts", kind: "function" },
    { name: "getContext", file: "server/src/modules/b/context.ts", kind: "function" },
  ],
  downstream: [
    {
      symbol: "getContext",
      file: "server/src/modules/a/context.ts",
      callers: [{ name: "handlerA", file: "server/src/modules/a/routes.ts", line: 5 }],
      endpoints_affected: ["GET /a"],
      crons_affected: [],
    },
    {
      symbol: "getContext",
      file: "server/src/modules/b/context.ts",
      callers: [{ name: "handlerB", file: "server/src/modules/b/routes.ts", line: 9 }],
      endpoints_affected: ["GET /b"],
      crons_affected: [],
    },
  ],
  summary: "2 symbols · 2 callers · 2 endpoints · 0 crons",
};

describe("BlastRadiusCard", () => {
  it("shows skeleton rows while isLoading, and nothing from the callers tree", () => {
    // Data AND loading together, deliberately: with `current` left undefined the
    // tree could never render, so the second assertion held whether or not the
    // `isLoading` branch existed. Populated, it fails the moment loading stops
    // taking precedence over available data.
    blastData.current = populated;
    blastData.loading = true;
    renderCard();
    expect(screen.getByRole("status", { name: "Reading the code index…" })).toBeInTheDocument();
    expect(screen.queryByText("getContext")).not.toBeInTheDocument();
  });

  it("renders nothing when there is no data (error path)", () => {
    blastData.current = undefined;
    blastData.loading = false;
    // `toBeEmptyDOMElement`, not a pair of negative title queries: the contract is
    // `if (!blast) return null`, and absence-of-title is weaker than absence-of-
    // anything. An error banner or the EmptyState ("Nothing downstream") carries no
    // title, so a title-only assertion would stay green under this test's own name.
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
    // Kept alongside, not instead: the populated test below asserts the positive
    // form of this exact query, so a pass here means the role really is absent
    // rather than the name never having matched.
    expect(screen.queryByRole("region", { name: "Blast radius" })).not.toBeInTheDocument();
  });

  it("renders the summary chips and one row per changed symbol", () => {
    blastData.current = populated;
    renderCard();
    // The positive form of the error path's negative query. Without this, that
    // test could pass because the name never matches anything, rather than
    // because the region is genuinely absent (client/INSIGHTS.md:120-124).
    expect(screen.getByRole("region", { name: "Blast radius" })).toBeInTheDocument();
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

    const toggle = screen.getByRole("button", {
      name: `Show callers of getContext in ${CONTEXT_FILE}`,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("server/src/modules/pulls/routes.ts:42")).not.toBeInTheDocument();

    await user.click(toggle);

    expect(
      screen.getByRole("button", { name: `Hide callers of getContext in ${CONTEXT_FILE}` }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("server/src/modules/pulls/routes.ts:42")).toBeInTheDocument();
    expect(screen.getByText("GET /pulls/:id")).toBeInTheDocument();
  });

  it("links a caller's file:line to GitHub pinned to the PR head sha", async () => {
    blastData.current = populated;
    const user = userEvent.setup();
    renderCard({ repoFullName: "acme/payments-api", headSha: "deadbeef" });

    await user.click(
      screen.getByRole("button", { name: `Show callers of getContext in ${CONTEXT_FILE}` }),
    );

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

    await user.click(
      screen.getByRole("button", { name: `Show callers of getContext in ${CONTEXT_FILE}` }),
    );

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
    await user.click(
      screen.getByRole("button", { name: `Show callers of getContext in ${CONTEXT_FILE}` }),
    );
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
    await user.click(
      screen.getByRole("button", { name: `Show callers of getContext in ${CONTEXT_FILE}` }),
    );
    expect(screen.queryByText("Showing the 20 highest-ranked callers")).not.toBeInTheDocument();
  });

  /**
   * Spec 0012 aliasing fix: two changed symbols with the SAME name, declared
   * in different files, must render as two rows that expand/collapse
   * independently and each show only their own callers — never the other
   * row's merged/duplicated data.
   */
  it("expands two same-named symbols independently and shows each its own callers", async () => {
    blastData.current = sameNamePopulated;
    const user = userEvent.setup();
    renderCard();

    const showA = "Show callers of getContext in server/src/modules/a/context.ts";
    const hideA = "Hide callers of getContext in server/src/modules/a/context.ts";
    const showB = "Show callers of getContext in server/src/modules/b/context.ts";
    const hideB = "Hide callers of getContext in server/src/modules/b/context.ts";

    expect(screen.getByRole("button", { name: showA })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: showB })).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button", { name: showA }));

    // Only row A opened; row B stays collapsed — independent expand state.
    // Re-queried from `screen`, not a held reference: the accessible name
    // changes with the open state (Show → Hide).
    expect(screen.getByRole("button", { name: hideA })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: showB })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("server/src/modules/a/routes.ts:5")).toBeInTheDocument();
    expect(screen.queryByText("server/src/modules/b/routes.ts:9")).not.toBeInTheDocument();
    expect(screen.getByText("GET /a")).toBeInTheDocument();
    expect(screen.queryByText("GET /b")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: showB }));

    // Both now open, each still showing only its own caller — not merged.
    expect(screen.getByRole("button", { name: hideA })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: hideB })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("server/src/modules/a/routes.ts:5")).toBeInTheDocument();
    expect(screen.getByText("server/src/modules/b/routes.ts:9")).toBeInTheDocument();
    expect(screen.getByText("GET /a")).toBeInTheDocument();
    expect(screen.getByText("GET /b")).toBeInTheDocument();
  });
});
