import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { EvalBatchDetail, EvalRunRecord } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import evalsMessages from "../../../../../../../../../../messages/en/evals.json";

const h = vi.hoisted(() => ({
  data: undefined as EvalBatchDetail | undefined,
  isLoading: false,
  isError: false,
  error: undefined as Error | undefined,
}));
const refetch = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useEvalBatch: () => ({ data: h.data, isLoading: h.isLoading, isError: h.isError, error: h.error, refetch }),
}));

import { CaseDetailDialog } from "./CaseDetailDialog";

function makeRun(over: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return {
    id: "run-1",
    case_id: "case-1",
    case_name: "Flags the secret",
    ran_at: "2026-10-01T00:00:00.000Z",
    actual_output: { findings: [{ message: "INJECTED-FINDING-TEXT" }] },
    pass: true,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    duration_ms: 500,
    cost_usd: 0.001,
    ...over,
  };
}

function renderDialog() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ evals: evalsMessages }}>
      <CaseDetailDialog batchId="batch-1" onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  h.data = undefined;
  h.isLoading = false;
  h.isError = false;
  h.error = undefined;
  refetch.mockReset();
});
afterEach(cleanup);

describe("CaseDetailDialog — rows (AC-75, AC-80, AC-81)", () => {
  it("renders one row per run with case name, pass state as text, and the three metrics", () => {
    h.data = {
      batch: { cases_total: 2 } as EvalBatchDetail["batch"],
      runs: [makeRun({ id: "r1", case_name: "Flags the secret", pass: true }), makeRun({ id: "r2", case_name: "No false positive", pass: false })],
    };
    renderDialog();
    expect(screen.getByText("Flags the secret")).toBeInTheDocument();
    expect(screen.getByText("No false positive")).toBeInTheDocument();
    expect(screen.getByText("Pass")).toBeInTheDocument();
    expect(screen.getByText("Fail")).toBeInTheDocument();
    expect(screen.getAllByText("100%").length).toBeGreaterThan(0);
  });

  it("a null case_name renders the placeholder, never 'null' or an empty cell", () => {
    h.data = { batch: { cases_total: 1 } as EvalBatchDetail["batch"], runs: [makeRun({ case_name: null })] };
    renderDialog();
    expect(screen.getByText(evalsMessages.placeholder)).toBeInTheDocument();
    expect(screen.queryByText(/^null$/)).not.toBeInTheDocument();
  });

  it("renders no part of actual_output anywhere in the dialog", () => {
    h.data = { batch: { cases_total: 1 } as EvalBatchDetail["batch"], runs: [makeRun()] };
    renderDialog();
    expect(screen.queryByText(/INJECTED-FINDING-TEXT/)).not.toBeInTheDocument();
  });
});

describe("CaseDetailDialog — loading / error / empty / deleted-cases (AC-76 – AC-79)", () => {
  it("while loading, shows a role=status indicator with its own aria-label", () => {
    h.isLoading = true;
    renderDialog();
    expect(screen.getByRole("status", { name: evalsMessages.caseDetail.loading })).toBeInTheDocument();
  });

  it("on failure, shows error.message and a retry control, and stays open", async () => {
    const user = userEvent.setup();
    h.isError = true;
    renderDialog();
    expect(screen.getByText(evalsMessages.caseDetail.loadError)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  // AC-77 names the source precisely: "the API error envelope's `error.message`",
  // not a generic namespace string. `useEvalBatch` surfaces that as the
  // `error` TanStack Query returns (see client/src/lib/api.ts's `ApiError`,
  // whose `.message` is read straight from `body.error.message`). A REAL
  // `ApiError` — not a loose `{ message }` double — so this fails loudly if
  // the component is only ever rendering a static translated string.
  it("on failure, renders the API error envelope's error.message verbatim, not a generic string", async () => {
    h.isError = true;
    h.error = new ApiError("Case run scoring failed: upstream rate limited (429)", 429);
    renderDialog();
    expect(screen.getByText("Case run scoring failed: upstream rate limited (429)")).toBeInTheDocument();
  });

  // The structural check this replaces ("does it have a string `.message`?")
  // would have let this through: a `TypeError` is an object with a string
  // `message` too. Only a real `ApiError` envelope's message may reach the
  // user; any other thrown error (a dropped connection, an aborted fetch)
  // falls back to the generic sentence.
  it("a non-ApiError failure (e.g. a dropped connection) renders the generic string, not the raw error message", () => {
    h.isError = true;
    h.error = new TypeError("Failed to fetch");
    renderDialog();
    expect(screen.getByText(evalsMessages.caseDetail.loadError)).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
  });

  it("an empty runs array renders the empty-state message", () => {
    h.data = { batch: { cases_total: 0 } as EvalBatchDetail["batch"], runs: [] };
    renderDialog();
    expect(screen.getByText(evalsMessages.caseDetail.empty)).toBeInTheDocument();
  });

  it("fewer runs than cases_total names the difference as cases deleted since the sweep", () => {
    h.data = {
      batch: { cases_total: 20 } as EvalBatchDetail["batch"],
      runs: Array.from({ length: 17 }, (_, i) => makeRun({ id: `r${i}` })),
    };
    renderDialog();
    expect(screen.getByText(/3 cases have been deleted/)).toBeInTheDocument();
  });

  it("an equal count renders no deleted-cases note (negative control)", () => {
    h.data = {
      batch: { cases_total: 20 } as EvalBatchDetail["batch"],
      runs: Array.from({ length: 20 }, (_, i) => makeRun({ id: `r${i}` })),
    };
    renderDialog();
    expect(screen.queryByText(/have been deleted/)).not.toBeInTheDocument();
  });
});
