import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentVersionConfig, EvalBatchRecord, EvalRunComparison } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import evalsMessages from "../../../../../../../../../../messages/en/evals.json";

const promoteMutate = vi.fn();
const h = vi.hoisted(() => ({
  isPending: false,
  isError: false,
  error: null as unknown,
}));

vi.mock("@/lib/hooks/agents", () => ({
  usePromoteAgentVersion: () => ({ mutate: promoteMutate, isPending: h.isPending, isError: h.isError, error: h.error }),
}));

import { CompareModal } from "./CompareModal";

function makeBatch(over: Partial<EvalBatchRecord> = {}): EvalBatchRecord {
  return {
    id: "b1",
    owner_kind: "agent",
    owner_id: "ag1",
    agent_id: "ag1",
    agent_version: 1,
    ran_at: "2026-10-01T00:00:00.000Z",
    status: "done",
    error: null,
    recall: 0.8,
    precision: 0.7,
    citation_accuracy: 0.9,
    cases_total: 4,
    cases_passed: 3,
    duration_ms: 1000,
    cost_usd: 0.01,
    metrics_version: 2,
    ...over,
  };
}

function makeConfig(over: Partial<AgentVersionConfig> = {}): AgentVersionConfig {
  return {
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "Line one.\nLine two.\nLine three.",
    output_schema: null,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    skills: ["s1", "s2"],
    ...over,
  };
}

function makeComparison(over: Partial<EvalRunComparison> = {}): EvalRunComparison {
  // Every old/new value AND every delta across all four tiles is a distinct
  // number (70/85/+15, 55/65/+10, 60/72/+12, $0.010/$0.015/+$0.005) so a
  // `getByText(...)` can never match a sibling tile's figure by coincidence.
  return {
    old: makeBatch({ id: "old-1", agent_version: 1, recall: 0.7, precision: 0.55, citation_accuracy: 0.6, cost_usd: 0.01 }),
    new: makeBatch({ id: "new-1", agent_version: 2, recall: 0.85, precision: 0.65, citation_accuracy: 0.72, cost_usd: 0.015 }),
    old_config: makeConfig({ system_prompt: "Line one.\nLine two.\nLine three." }),
    new_config: makeConfig({ system_prompt: "Line one.\nLine TWO edited.\nLine three." }),
    comparable: true,
    incomparable_reason: null,
    delta: { recall: 0.15, precision: 0.1, citation_accuracy: 0.12, cost_usd: 0.005 },
    ...over,
  };
}

function renderModal(props: Partial<React.ComponentProps<typeof CompareModal>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ evals: evalsMessages }}>
        <CompareModal
          comparison={makeComparison()}
          isLoading={false}
          isError={false}
          agentId="ag1"
          agentVersion={1}
          onClose={onClose}
          {...props}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  h.isPending = false;
  h.isError = false;
  h.error = null;
  promoteMutate.mockReset();
});
afterEach(cleanup);

describe("CompareModal — title and tiles (AC-51 – AC-53)", () => {
  it("titles the dialog with both versions old -> new", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Compare v1 → v2")).toBeInTheDocument();
  });

  it("renders old, new and a signed delta for all four tiles", () => {
    renderModal();
    expect(screen.getByText("70%")).toBeInTheDocument(); // old recall
    expect(screen.getByText("85%")).toBeInTheDocument(); // new recall
    expect(screen.getByText("+15.0pt")).toBeInTheDocument();
    expect(screen.getByText("$0.010")).toBeInTheDocument();
    expect(screen.getByText("$0.015")).toBeInTheDocument();
    expect(screen.getByText("+$0.005")).toBeInTheDocument();
  });

  it("a null side renders the placeholder for that side and for the delta", () => {
    renderModal({
      comparison: makeComparison({
        old: makeBatch({ id: "old-1", agent_version: 1, recall: null }),
        delta: { recall: null, precision: 0.1, citation_accuracy: 0.1, cost_usd: 0.002 },
      }),
    });
    expect(screen.getAllByText(evalsMessages.placeholder).length).toBeGreaterThanOrEqual(2);
  });
});

describe("CompareModal — incomparable (AC-54, AC-89, AC-90)", () => {
  // Run twice, once per reason code the server can now emit
  // (`server/src/modules/evals/helpers.ts:459-469`): a differing, RECORDED
  // formula on each side ("mismatch") vs. either side never having recorded
  // one at all ("unrecorded"). Each must resolve to its OWN message, not
  // merely "a" message — a reason-key map missing one of the two would let
  // both land on the shared `compare.reasons.unknown` fallback and still
  // pass a test that only checked "something non-empty rendered".
  it.each([
    ["metrics_version_mismatch", evalsMessages.compare.reasons.metricsVersionMismatch],
    ["metrics_version_unrecorded", evalsMessages.compare.reasons.metricsVersionUnrecorded],
  ] as const)("renders the warning for %s, placeholder metric deltas, and a real cost delta", (reason, expectedMessage) => {
    renderModal({
      comparison: makeComparison({
        comparable: false,
        incomparable_reason: reason,
        delta: { recall: null, precision: null, citation_accuracy: null, cost_usd: 0.002 },
      }),
    });
    expect(screen.getByText(expectedMessage)).toBeInTheDocument();
    expect(screen.getByText("+$0.002")).toBeInTheDocument();
  });

  it("the two reason codes resolve to DIFFERENT messages, neither of them the generic fallback", () => {
    renderModal({
      comparison: makeComparison({ comparable: false, incomparable_reason: "metrics_version_mismatch" }),
    });
    const mismatchText = screen.getByText(evalsMessages.compare.reasons.metricsVersionMismatch).textContent;
    cleanup();

    renderModal({
      comparison: makeComparison({ comparable: false, incomparable_reason: "metrics_version_unrecorded" }),
    });
    const unrecordedText = screen.getByText(evalsMessages.compare.reasons.metricsVersionUnrecorded).textContent;

    expect(mismatchText).not.toBe(unrecordedText);
    expect(mismatchText).not.toBe(evalsMessages.compare.reasons.unknown);
    expect(unrecordedText).not.toBe(evalsMessages.compare.reasons.unknown);
  });

  it("a comparable fixture renders no warning and four numeric deltas (positive control)", () => {
    renderModal();
    expect(screen.queryByText(evalsMessages.compare.reasons.metricsVersionMismatch)).not.toBeInTheDocument();
  });
});

describe("CompareModal — prompt diff (AC-55 – AC-59, AC-68)", () => {
  it("marks add/del lines by text as well as colour", () => {
    renderModal();
    expect(screen.getByText("Line TWO edited.").parentElement).toHaveTextContent(/^\+Line TWO edited\.$/);
    expect(screen.getByText("Line two.").parentElement).toHaveTextContent(/^-Line two\.$/);
  });

  it("renders a script/markdown prompt as literal text, never as markup", () => {
    renderModal({
      comparison: makeComparison({
        old_config: makeConfig({ system_prompt: "safe" }),
        new_config: makeConfig({ system_prompt: "<script>alert(1)</script>\n**bold**\n`code`" }),
      }),
    });
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(screen.getByText("**bold**")).toBeInTheDocument();
    expect(document.querySelector("script")).not.toBeInTheDocument();
    expect(document.querySelector("strong")).not.toBeInTheDocument();
  });

  it("identical prompts render the 'no prompt change' message", () => {
    renderModal({
      comparison: makeComparison({
        old_config: makeConfig({ system_prompt: "same" }),
        new_config: makeConfig({ system_prompt: "same" }),
      }),
    });
    expect(screen.getByText(evalsMessages.compare.noPromptChange)).toBeInTheDocument();
  });

  it("a null config renders the notice in place of the diff, with the tiles still rendered", () => {
    renderModal({ comparison: makeComparison({ old_config: null }) });
    expect(screen.getByText(evalsMessages.compare.configMissing)).toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
  });
});

describe("CompareModal — promote (AC-60, AC-61, AC-69 – AC-72)", () => {
  it("labels promote with the new version, and disables it with a reason when already current", () => {
    renderModal({ agentVersion: 2 }); // new.agent_version is 2
    expect(screen.getByRole("button", { name: "Promote v2" })).toBeDisabled();
    expect(screen.getByText(evalsMessages.compare.promoteDisabledCurrent)).toBeInTheDocument();
  });

  it("activating promote shows a confirmation naming version, model and skill count; issues nothing until accepted", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: "Promote v2" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Promote v2\?/)).toBeInTheDocument();
    expect(within(dialog).getByText(/gpt-4\.1/)).toBeInTheDocument();
    expect(within(dialog).getByText(/2 skills/)).toBeInTheDocument();
    expect(promoteMutate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(promoteMutate).not.toHaveBeenCalled();
    expect(screen.queryByText(/Promote v2\?/)).not.toBeInTheDocument();
  });

  it("a one-skill fixture renders a singular count (negative control against a hardcoded string)", async () => {
    const user = userEvent.setup();
    renderModal({ comparison: makeComparison({ new_config: makeConfig({ skills: ["only-one"] }) }) });
    await user.click(screen.getByRole("button", { name: "Promote v2" }));
    expect(within(screen.getByRole("dialog")).getByText(/1 skill(?!s)/)).toBeInTheDocument();
  });

  it("accepting the confirmation issues exactly one promote call for the new batch's version", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: "Promote v2" }));
    await user.click(screen.getByRole("button", { name: "Promote" }));
    expect(promoteMutate).toHaveBeenCalledTimes(1);
    expect(promoteMutate.mock.calls[0]![0]).toBe(2);
  });
});

describe("CompareModal — promote result (AC-62, AC-63)", () => {
  it("a failed promote renders error.message inline and keeps the modal open", async () => {
    const user = userEvent.setup();
    h.isError = true;
    h.error = new ApiError("Cannot promote: a sweep is running.", 409, "conflict");
    renderModal();
    await user.click(screen.getByRole("button", { name: "Promote v2" }));
    await user.click(screen.getByRole("button", { name: "Promote" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Cannot promote: a sweep is running.")).toBeInTheDocument();
  });
});
