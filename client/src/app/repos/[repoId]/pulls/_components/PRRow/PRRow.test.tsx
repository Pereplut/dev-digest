/**
 * PRRow — the COST column shows the latest review round's cost: exact, "≥"
 * when some run in the round has no price, and "—" when nothing is priced.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { PRRow } from "./PRRow";

afterEach(cleanup);

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

describe("PRRow — COST column", () => {
  it("shows the latest review round cost", () => {
    renderRow(pr({ cost_usd: 0.014, cost_complete: true }));
    expect(screen.getByText("$0.014")).toBeInTheDocument();
  });

  it("marks a partial round with ≥ and explains it in a tooltip", () => {
    renderRow(pr({ cost_usd: 0.014, cost_complete: false }));
    expect(screen.getByText("≥$0.014")).toHaveAttribute("title", messages.list.costPartial);
  });

  it("shows — when no run is priced, never $0.00", () => {
    renderRow(pr({ cost_usd: null, cost_complete: null }));
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});
