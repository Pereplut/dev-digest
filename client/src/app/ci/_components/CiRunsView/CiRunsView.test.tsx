import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CiRefreshResult, CiRun } from "@devdigest/shared";
import ciMessages from "../../../../../messages/en/ci.json";

/**
 * CiRunsView (spec 0022: AC-72..75). Boundary mocked: `@/lib/api`; the real
 * React Query hooks, table, badges and i18n catalogue run.
 */

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { get: apiGet, post: apiPost } }));

import { CiRunsView } from "./CiRunsView";

function run(over: Partial<CiRun>): CiRun {
  return {
    id: "run1",
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    ci_installation_id: "i1",
    repo: "acme/payments-api",
    pr_number: 42,
    commit_sha: "a".repeat(40),
    actions_run_id: 7,
    job_url: "https://github.com/acme/payments-api/actions/runs/7",
    verdict: "approve",
    status: "succeeded",
    error: null,
    findings_count: 3,
    cost_usd: 0.014,
    duration_ms: 83_000,
    ran_at: "2026-10-01T12:00:00.000Z",
    ...over,
  };
}

function refreshResult(over: Partial<CiRefreshResult>): CiRefreshResult {
  return { degraded: false, message: null, ingested: 0, skipped: 0, ...over };
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
});
afterEach(cleanup);

function renderView() {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
        <CiRunsView />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { user };
}

describe("CiRunsView", () => {
  it("shows rows with the formatted cells and an Actions job link; a failed run reads 'Failed' and a missing PR/agent/findings count reads as a dash", async () => {
    apiGet.mockResolvedValue([
      run({}),
      run({
        id: "run2",
        repo: "acme/web",
        status: "failed",
        verdict: "request_changes",
        pr_number: null,
        agent_name: null,
        findings_count: null,
        cost_usd: null,
        duration_ms: null,
      }),
    ]);
    renderView();

    const table = await screen.findByRole("table", { name: "CI Runs" });
    expect(apiGet).toHaveBeenCalledWith("/ci/runs");
    const [, first, second] = within(table).getAllByRole("row");

    expect(first).toHaveTextContent("acme/payments-api");
    expect(first).toHaveTextContent("#42");
    expect(first).toHaveTextContent("Security Reviewer");
    expect(first).toHaveTextContent("Approve");
    expect(first).toHaveTextContent("$0.014");
    expect(first).toHaveTextContent("1m 23s");
    expect(within(first!).getByRole("link", { name: "View job" })).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/actions/runs/7",
    );

    expect(second).toHaveTextContent("acme/web");
    expect(second).toHaveTextContent("Failed");
    expect(second).not.toHaveTextContent("Request changes");
    expect(within(second!).getAllByText("—").length).toBeGreaterThanOrEqual(5);
  });

  it("shows the empty state when there are no runs, and an error state with working Retry when the load fails", async () => {
    apiGet.mockResolvedValueOnce([]);
    renderView();
    expect(await screen.findByText("No CI runs yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    cleanup();

    apiGet.mockReset();
    apiGet.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce([run({})]);
    const { user } = renderView();
    expect(await screen.findByText("Could not load CI runs.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("while loading neither the table nor the empty state shows", () => {
    apiGet.mockReturnValue(new Promise(() => {}));
    renderView();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("No CI runs yet")).not.toBeInTheDocument();
  });

  it("Refresh posts once to /ci/refresh and refetches; a degraded result shows its message in a status banner and keeps the rows", async () => {
    apiGet.mockResolvedValue([run({})]);
    apiPost.mockResolvedValue(refreshResult({ degraded: true, message: "GitHub rate limit reached" }));
    const { user } = renderView();
    await screen.findByRole("table");
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByRole("status")).toHaveTextContent("GitHub rate limit reached");
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith("/ci/refresh");
    expect(await screen.findByRole("table")).toBeInTheDocument(); // rows stay on screen
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a degraded refresh with no message falls back to the default banner text", async () => {
    apiGet.mockResolvedValue([run({})]);
    apiPost.mockResolvedValue(refreshResult({ degraded: true, message: null }));
    const { user } = renderView();
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Refresh was degraded — showing the runs already ingested.",
    );
  });

  it("a non-degraded refresh shows no banner; a rejected refresh shows an alert and keeps the rows", async () => {
    apiGet.mockResolvedValue([run({})]);
    apiPost.mockResolvedValueOnce(refreshResult({ ingested: 1 }));
    const { user } = renderView();
    await screen.findByRole("table");

    const getsBefore = apiGet.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    // A successful refresh invalidates the runs query, so the refetch marks it as settled.
    await waitFor(() => expect(apiGet.mock.calls.length).toBeGreaterThan(getsBefore));
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    apiPost.mockRejectedValueOnce(new Error("token expired"));
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Refresh failed: token expired");
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
