import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import prReview from "../../../../../../../../messages/en/prReview.json";
import multiAgentReview from "../../../../../../../../messages/en/multiAgentReview.json";
import type { PrDetail } from "@/lib/types";

const latest = vi.hoisted(() => ({ run: null as null | { id: string } }));
const latestSpy = vi.hoisted(() => vi.fn());

vi.mock("@/lib/hooks/multiAgentReview", () => ({
  useLatestMultiAgentRun: (prId: unknown) => {
    latestSpy(prId);
    return { data: { run: latest.run } };
  },
}));
// The picker has its own hooks and test; here it is only a marker.
vi.mock("../AgentPicker", () => ({ AgentPicker: () => <div>picker</div> }));

import { PrDetailHeader } from "./PrDetailHeader";

const PR = {
  number: 7,
  title: "Add limiter",
  author: "marisa",
  branch: "feat/x",
  base: "main",
  additions: 1,
  deletions: 2,
  status: "open",
  files_count: 1,
} as unknown as PrDetail;

beforeEach(() => {
  latest.run = null;
  latestSpy.mockClear();
});
afterEach(cleanup);

function renderHeader() {
  render(
    <NextIntlClientProvider locale="en" messages={{ prReview, multiAgentReview }}>
      <PrDetailHeader
        pr={PR}
        prId="pr1"
        tab="overview"
        findingsCount={0}
        onSetTab={vi.fn()}
        onRunStart={vi.fn()}
        onRunsStarted={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("PrDetailHeader multi-agent link (AC-27)", () => {
  it("links to the latest run when the PR has one", () => {
    latest.run = { id: "m9" };
    renderHeader();
    expect(screen.getByRole("link", { name: "Multi-Agent Review" })).toHaveAttribute(
      "href",
      "/multi-agent-review/m9",
    );
    expect(latestSpy).toHaveBeenCalledWith("pr1");
    expect(screen.getByText("picker")).toBeInTheDocument();
  });

  it("renders no link when the latest route returns { run: null }", () => {
    renderHeader();
    expect(screen.queryByRole("link", { name: "Multi-Agent Review" })).not.toBeInTheDocument();
  });
});
