import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/multiAgentReview.json";
import { landingTarget } from "./helpers";

const replace = vi.fn();
const state = vi.hoisted(() => ({
  search: "",
  latest: { data: undefined as unknown, isLoading: false },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/hooks/multiAgentReview", () => ({
  useLatestMultiAgentRun: () => state.latest,
}));
vi.mock("../ConfigureRun", () => ({
  ConfigureRun: ({ initialPrId }: { initialPrId?: string | null }) => (
    <div>configure:{initialPrId ?? "none"}</div>
  ),
}));

import { MultiAgentLanding } from "./MultiAgentLanding";

const RUN = { id: "m1", pr_id: "pr1", pr_number: 1, ran_at: "2026-10-15T00:00:00Z" };

beforeEach(() => {
  replace.mockReset();
  state.search = "";
  state.latest = { data: undefined, isLoading: false };
});
afterEach(cleanup);

function renderLanding() {
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgentReview: messages }}>
      <MultiAgentLanding />
    </NextIntlClientProvider>,
  );
}

describe("landingTarget", () => {
  it("is the run id, unless ?new=1 or there is no run", () => {
    expect(landingTarget(false, { run: RUN })).toBe("m1");
    expect(landingTarget(true, { run: RUN })).toBeNull();
    expect(landingTarget(false, { run: null })).toBeNull();
    expect(landingTarget(false, undefined)).toBeNull();
  });
});

describe("MultiAgentLanding (AC-29)", () => {
  it("redirects to the newest run when one exists", () => {
    state.latest = { data: { run: RUN }, isLoading: false };
    renderLanding();
    expect(replace).toHaveBeenCalledWith("/multi-agent-review/m1");
    expect(screen.queryByText(/configure:/)).not.toBeInTheDocument();
  });

  it("renders Configure run, with ?pr= passed through, when there is no run", () => {
    state.search = "pr=pr5";
    state.latest = { data: { run: null }, isLoading: false };
    renderLanding();
    expect(screen.getByText("configure:pr5")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("renders Configure run for ?new=1 even when a run exists", () => {
    state.search = "new=1";
    state.latest = { data: { run: RUN }, isLoading: false };
    renderLanding();
    expect(screen.getByText("configure:none")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows a status placeholder, not Configure run, while the query loads", () => {
    state.latest = { data: undefined, isLoading: true };
    renderLanding();
    expect(
      screen.getByRole("status", { name: "Looking for a recent multi-agent review…" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/configure:/)).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
