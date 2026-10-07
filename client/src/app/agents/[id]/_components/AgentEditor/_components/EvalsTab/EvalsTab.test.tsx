import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EvalBatchRecord, EvalCase, EvalRunRecord, RunEvent } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import evalsMessages from "../../../../../../../../messages/en/evals.json";

interface QueryStub<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
}

const h = vi.hoisted(() => ({
  cases: { data: [] as unknown[], isLoading: false, isError: false },
  batches: { data: [] as unknown[], isLoading: false, isError: false },
  batchDetail: undefined as { batch: unknown; runs: unknown[] } | undefined,
  events: [] as unknown[],
  // Mirrors `useRunEvents`' real `running` flag (true until the SSE stream
  // closes). Tests that need the falling edge flip this and re-render —
  // flipping the mocked RETURN VALUE synchronously (as the old static mock
  // did) can never reach it.
  running: true,
}));

const runEvalsMutate = vi.fn();
const casesRefetch = vi.fn();
const batchesRefetch = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useAgentEvalCases: () => ({ ...h.cases, refetch: casesRefetch }),
  useAgentEvalBatches: () => ({ ...h.batches, refetch: batchesRefetch }),
  useEvalBatch: () => ({ data: h.batchDetail }),
  useRunEvals: () => ({ mutate: runEvalsMutate, isPending: false }),
}));

vi.mock("@/lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: h.events, running: h.running }),
}));

import { EvalsTab } from "./EvalsTab";

function makeCase(over: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "case-1",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "Flags the hardcoded secret",
    input_diff: "diff --git a/a b/a",
    input_files: null,
    input_meta: null,
    expected_output: null,
    notes: null,
    expectation_kind: "must_find",
    expected_file: "src/config.ts",
    expected_start_line: 10,
    expected_end_line: 10,
    source_finding_id: "f1",
    created_at: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

function makeBatch(over: Partial<EvalBatchRecord> = {}): EvalBatchRecord {
  return {
    id: "batch-1",
    owner_kind: "agent",
    owner_id: "ag1",
    agent_id: "ag1",
    agent_version: 1,
    ran_at: "2026-10-01T00:00:00.000Z",
    status: "done",
    error: null,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    cases_total: 2,
    cases_passed: 2,
    duration_ms: 1000,
    cost_usd: 0.014,
    ...over,
  };
}

function makeRun(over: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return {
    id: "run-1",
    case_id: "case-1",
    case_name: "case",
    ran_at: "2026-10-01T00:00:00.000Z",
    actual_output: {},
    pass: true,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    duration_ms: 500,
    cost_usd: 0.001,
    ...over,
  };
}

function setQuery<T>(stub: { data: unknown; isLoading: boolean; isError: boolean }, next: Partial<QueryStub<T>>) {
  Object.assign(stub, next);
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderTab(qc: QueryClient = makeQueryClient()) {
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, evals: evalsMessages }}>
        <EvalsTab agentId="ag1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setQuery(h.cases, { data: [], isLoading: false, isError: false });
  setQuery(h.batches, { data: [], isLoading: false, isError: false });
  h.batchDetail = undefined;
  h.events = [];
  h.running = true;
  runEvalsMutate.mockReset();
  casesRefetch.mockReset();
  batchesRefetch.mockReset();
});
afterEach(cleanup);

describe("EvalsTab — tiles (AC-55, AC-56, AC-73)", () => {
  it("a completed batch renders five tiles with the fixture's numbers", () => {
    setQuery(h.cases, { data: [makeCase(), makeCase({ id: "case-2" })] });
    setQuery(h.batches, {
      data: [makeBatch({ recall: 0.8, precision: 2 / 3, citation_accuracy: 1, cases_passed: 1, cases_total: 2, cost_usd: 0.014 })],
    });
    renderTab();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("$0.014")).toBeInTheDocument();
  });

  it("a null cost_usd renders the placeholder while the other four tiles still show numbers", () => {
    setQuery(h.cases, { data: [makeCase()] });
    setQuery(h.batches, {
      data: [makeBatch({ recall: 1, precision: 0.5, citation_accuracy: 0.75, cost_usd: null })],
    });
    renderTab();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("no completed batch renders the placeholder in all five tiles, never NaN or null", () => {
    setQuery(h.cases, { data: [makeCase()] });
    setQuery(h.batches, { data: [] });
    renderTab();
    expect(screen.getAllByText("—")).toHaveLength(5);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^null$/)).not.toBeInTheDocument();
  });

  it("a cancelled newest batch does not mask an older completed one (negative control, AC-73)", () => {
    setQuery(h.cases, { data: [makeCase()] });
    setQuery(h.batches, {
      data: [
        makeBatch({
          id: "b-cancelled",
          status: "cancelled",
          ran_at: "2026-10-06T00:00:00.000Z",
          recall: 0.1,
          precision: 0.1,
          citation_accuracy: 0.1,
          cases_passed: 0,
          cases_total: 5,
          cost_usd: 0.5,
        }),
        makeBatch({
          id: "b-done",
          status: "done",
          ran_at: "2026-10-01T00:00:00.000Z",
          recall: 0.9,
          precision: 0.9,
          citation_accuracy: 0.9,
          cases_passed: 4,
          cases_total: 5,
          cost_usd: 0.002,
        }),
      ],
    });
    renderTab();
    expect(screen.getAllByText("90%")).toHaveLength(3);
    expect(screen.getByText("4/5")).toBeInTheDocument();
    expect(screen.getByText("$0.002")).toBeInTheDocument();
    expect(screen.queryByText("10%")).not.toBeInTheDocument();
    expect(screen.queryByText("0/5")).not.toBeInTheDocument();
    expect(screen.queryByText("$0.5")).not.toBeInTheDocument();
  });
});

describe("EvalsTab — latest batch is element 0, never re-sorted (AC-74)", () => {
  it("a queued batch at index 0 (older than a done batch at index 1) still drives progress + disables Run", () => {
    setQuery(h.cases, { data: [makeCase()] });
    setQuery(h.batches, {
      data: [
        makeBatch({ id: "b-queued", status: "queued", ran_at: "2026-10-01T00:00:00.000Z", cases_total: 3 }),
        makeBatch({
          id: "b-done",
          status: "done",
          ran_at: "2026-10-06T00:00:00.000Z",
          recall: 1,
          precision: 0.5,
          citation_accuracy: 0.75,
        }),
      ],
    });
    h.events = [];
    renderTab();
    expect(screen.getByText("0/3 cases")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeDisabled();
    // The tiles still find the DONE batch for its own numbers, wherever it sits.
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
  });
});

describe("EvalsTab — case list (AC-58)", () => {
  it("renders one row per case with name, kind, expected range and pass state", () => {
    const mustFind = makeCase({ id: "case-1", name: "Flags the hardcoded secret" });
    const mustNotFlag = makeCase({
      id: "case-2",
      name: "No false positive on a comment",
      expectation_kind: "must_not_flag",
      expected_file: "src/util.ts",
      expected_start_line: 5,
      expected_end_line: 8,
    });
    setQuery(h.cases, { data: [mustFind, mustNotFlag] });
    const batch = makeBatch();
    setQuery(h.batches, { data: [batch] });
    h.batchDetail = {
      batch,
      runs: [makeRun({ case_id: "case-1", pass: true }), makeRun({ case_id: "case-2", pass: false })],
    };
    renderTab();
    expect(screen.getByText("Flags the hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("No false positive on a comment")).toBeInTheDocument();
    expect(screen.getByText("Must find")).toBeInTheDocument();
    expect(screen.getByText("Must not flag")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:10")).toBeInTheDocument();
    expect(screen.getByText("src/util.ts:5-8")).toBeInTheDocument();
    expect(screen.getByText("Pass")).toBeInTheDocument();
    expect(screen.getByText("Fail")).toBeInTheDocument();
  });

  it("a case with no run yet renders 'Not run'", () => {
    setQuery(h.cases, { data: [makeCase()] });
    setQuery(h.batches, { data: [] });
    renderTab();
    expect(screen.getByText("Not run")).toBeInTheDocument();
  });
});

describe("EvalsTab — empty state (AC-57)", () => {
  it("zero cases renders the empty-state message and disables Run all evals", () => {
    setQuery(h.cases, { data: [] });
    setQuery(h.batches, { data: [] });
    renderTab();
    expect(screen.getByText(evalsMessages.empty)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeDisabled();
  });
});

describe("EvalsTab — live progress (AC-59, AC-61)", () => {
  it("a running batch renders k/cases_total from the event stream and disables Run all evals", () => {
    setQuery(h.cases, { data: [makeCase()] });
    setQuery(h.batches, { data: [makeBatch({ status: "running", cases_total: 3 })] });
    h.events = [
      {
        runId: "batch-1",
        seq: 1,
        kind: "result",
        msg: "Case 1/3 case-a: PASS — recall 1 precision 1 citation 1",
        t: "2026-10-01T00:00:00.000Z",
        data: { evalCase: { index: 1, total: 3, pass: true } },
      },
    ] as RunEvent[];
    renderTab();
    expect(screen.getByText("1/3 cases")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeDisabled();
  });
});

describe("EvalsTab — stream completion refetches the batch (edge case, specs/0019-evals.md:413-414)", () => {
  it("invalidates the batch list and the live batch's detail on the running→false falling edge", () => {
    setQuery(h.cases, { data: [makeCase()] });
    setQuery(h.batches, { data: [makeBatch({ id: "b-live", status: "running", cases_total: 3 })] });
    h.events = [];
    h.running = true;
    const qc = makeQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { rerender } = renderTab(qc);

    // Still "running" — no invalidation yet, and the button is still disabled.
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeDisabled();

    // The SSE stream closes (the real `useRunEvents` flips `running` to false
    // on its EventSource `onerror`). A test that only ever returns
    // `running: true` synchronously can never exercise this transition — it
    // is exactly the bug: nothing re-renders, so nothing invalidates.
    h.running = false;
    rerender(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, evals: evalsMessages }}>
          <EvalsTab agentId="ag1" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agent-eval-batches", "ag1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eval-batch", "b-live"] });
  });

  it("does not re-invalidate on a later render once the stream has already settled (no request storm)", () => {
    setQuery(h.cases, { data: [makeCase()] });
    setQuery(h.batches, { data: [makeBatch({ id: "b-live", status: "running", cases_total: 3 })] });
    h.running = true;
    const qc = makeQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const tree = (
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, evals: evalsMessages }}>
          <EvalsTab agentId="ag1" />
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
    const { rerender } = renderTab(qc);
    h.running = false;
    rerender(tree);
    expect(invalidateSpy).toHaveBeenCalledTimes(2);

    // A parent re-render with running still false must not re-fire.
    rerender(tree);
    rerender(tree);
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it("never invalidates when the run was never live (no false edge on mount)", () => {
    setQuery(h.cases, { data: [makeCase()] });
    setQuery(h.batches, { data: [makeBatch({ id: "b-done", status: "done" })] });
    h.running = false;
    const qc = makeQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    renderTab(qc);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("EvalsTab — Run all evals confirmation (AC-60)", () => {
  it("shows a confirmation naming N and issues nothing until accepted; dismissing issues nothing", async () => {
    const user = userEvent.setup();
    setQuery(h.cases, { data: [makeCase({ id: "c1" }), makeCase({ id: "c2" }), makeCase({ id: "c3" }), makeCase({ id: "c4" })] });
    setQuery(h.batches, { data: [] });
    renderTab();
    await user.click(screen.getByRole("button", { name: "Run all evals" }));
    expect(screen.getByText("Run 4 eval case(s)?")).toBeInTheDocument();
    expect(runEvalsMutate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Run 4 eval case(s)?")).not.toBeInTheDocument();
    expect(runEvalsMutate).not.toHaveBeenCalled();
  });

  it("accepting the confirmation issues the run", async () => {
    const user = userEvent.setup();
    setQuery(h.cases, { data: [makeCase()] });
    setQuery(h.batches, { data: [] });
    renderTab();
    await user.click(screen.getByRole("button", { name: "Run all evals" }));
    await user.click(screen.getByRole("button", { name: "Run evals" }));
    expect(runEvalsMutate).toHaveBeenCalledTimes(1);
  });
});

describe("EvalsTab — load error", () => {
  it("renders an error state and retries both queries", async () => {
    const user = userEvent.setup();
    setQuery(h.cases, { data: undefined, isError: true });
    renderTab();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(casesRefetch).toHaveBeenCalled();
    expect(batchesRefetch).toHaveBeenCalled();
  });
});

describe("EvalsTab — every string resolves through next-intl (AC-62)", () => {
  it("renders missing-key markers, not readable English, against an empty message catalogue", () => {
    setQuery(h.cases, { data: [makeCase()] });
    setQuery(h.batches, { data: [makeBatch({ cost_usd: null })] });
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <NextIntlClientProvider
          locale="en"
          messages={{}}
          onError={() => {}}
          getMessageFallback={({ key, namespace }) => `MISSING:${namespace}.${key}`}
        >
          <EvalsTab agentId="ag1" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(screen.getAllByText(/^MISSING:/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Run all evals")).not.toBeInTheDocument();
    expect(screen.queryByText(evalsMessages.empty)).not.toBeInTheDocument();
  });
});
