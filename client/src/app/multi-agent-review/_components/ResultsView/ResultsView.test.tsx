import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentRun } from "@devdigest/shared";
import messages from "../../../../../messages/en/multiAgentReview.json";
import prReview from "../../../../../messages/en/prReview.json";
import evals from "../../../../../messages/en/evals.json";
import { column, conflict, finding, run } from "../testFixtures";

const h = vi.hoisted(() => ({ search: "", replace: vi.fn(), events: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(h.search),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
// Only the stream and the finding action are stubbed; the run query is the REAL hook over a mocked fetch.
vi.mock("@/lib/hooks/reviews", () => ({
  useRunEvents: (ids: string[]) => {
    h.events(ids);
    return { events: [], running: false };
  },
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/evals", () => ({ useCreateEvalCase: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("@/components/run-trace-drawer", () => ({
  default: (p: { runId: string; running?: boolean }) => (
    <div>
      drawer:{p.runId}:running={String(!!p.running)}
    </div>
  ),
}));

import { ResultsView } from "./ResultsView";

const state = { payload: run() as MultiAgentRun };
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
  ok: true,
  status: 200,
  json: async () => state.payload,
}));

beforeEach(() => {
  h.search = "";
  h.replace.mockReset();
  h.events.mockReset();
  fetchMock.mockClear();
  state.payload = run();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderResults() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ multiAgentReview: messages, prReview, evals }}>
        <ResultsView id="m1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("ResultsView", () => {
  it("shows the header and one column per agent with status, score, rows, error and labels", async () => {
    state.payload = run({
      agent_count: 3,
      columns: [
        column({ findings: [finding({ title: "Stripe key", file: "src/config.ts", start_line: 12 })] }),
        column({ run_id: "run-b", agent_name: "Performance", status: "failed", error: "model timed out", score: null, findings: [] }),
        column({ run_id: "run-c", agent_id: null, agent_name: null, status: "cancelled", score: null, findings: [] }),
      ],
      conflicts: [conflict()],
    });
    const { container } = renderResults();

    expect(await screen.findByRole("heading", { name: "Multi-Agent Review" })).toBeInTheDocument();
    expect(screen.getByText("3 selected agents · parallel")).toBeInTheDocument();
    expect(screen.getByText("Add rate limiting")).toBeInTheDocument();
    expect(screen.getByText("8.2s total · $0.20")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configure run" })).toHaveAttribute(
      "href",
      "/multi-agent-review?new=1&pr=pr1",
    );
    expect(screen.queryByText(/worktree/i)).not.toBeInTheDocument();

    const sec = within(screen.getByRole("region", { name: "Security" }));
    expect(sec.getByText("done")).toBeInTheDocument();
    expect(sec.getByRole("img", { name: "Score 38" })).toBeInTheDocument();
    expect(sec.getByText("8.2s · $0.06")).toBeInTheDocument();
    expect(sec.getByText("Stripe key")).toBeInTheDocument();
    expect(sec.getByText("src/config.ts:12")).toBeInTheDocument();
    expect(sec.getByText("1 finding")).toBeInTheDocument();

    expect(within(screen.getByRole("region", { name: "Performance" })).getByText("model timed out")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Unknown agent" })).getByText("Cancelled before it finished"),
    ).toBeInTheDocument();
    // The disagree block renders in the Columns view too.
    expect(screen.getByRole("region", { name: "Where agents disagree" })).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("polls every 3 s only while a column runs, and subscribes to running runs only", async () => {
    vi.useFakeTimers();
    state.payload = run({
      columns: [
        column({ run_id: "run-live", status: "running", score: null, findings: [] }),
        column({ run_id: "run-done" }),
      ],
    });
    renderResults();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(h.events).toHaveBeenLastCalledWith(["run-live"]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The run finishes: the next poll sees no running column, and polling stops.
    state.payload = run();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    const afterDone = fetchMock.mock.calls.length;
    expect(afterDone).toBe(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(h.events).toHaveBeenLastCalledWith([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(afterDone);
  });

  it("View trace sets ?trace=, and ?trace= mounts the shared drawer with running", async () => {
    const user = userEvent.setup();
    renderResults();
    await user.click(
      within(await screen.findByRole("region", { name: "Security" })).getByRole("button", { name: "View trace" }),
    );
    expect(h.replace).toHaveBeenCalledWith("/multi-agent-review/m1?trace=run-a");
    cleanup();

    h.search = "trace=run-live";
    state.payload = run({ columns: [column({ run_id: "run-live", status: "running", findings: [] })] });
    renderResults();
    expect(await screen.findByText("drawer:run-live:running=true")).toBeInTheDocument();
  });

  it("toggling Columns/Tabs issues no POST", async () => {
    const user = userEvent.setup();
    renderResults();
    const tabsBtn = await screen.findByRole("button", { name: "Tabs" });
    await user.click(tabsBtn);
    expect(tabsBtn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("tablist", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Where agents disagree" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method ?? "GET").toBe("GET");
    }
  });
});
