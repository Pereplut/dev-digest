import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, CiInstallation, CiRun, CiUpdateResult } from "@devdigest/shared";
import ciMessages from "../../../../../../../../messages/en/ci.json";

/**
 * CiTab (spec 0022: AC-56, AC-59, AC-60, AC-84).
 *
 * Boundary mocked: `@/lib/api` (the HTTP client). The real React Query hooks,
 * the tab, its rows and the i18n catalogue run. The ExportWizard's own data
 * hooks are stubbed at the same boundary as ExportWizard.test.tsx.
 */

const { apiGet, apiPost, apiPut } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: { get: apiGet, post: apiPost, put: apiPut } }));
vi.mock("@/lib/hooks", () => ({ useRepos: () => ({ data: [] }) }));
vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ activeRepo: null }) }));

import { CiTab } from "./CiTab";

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

const RUN: CiRun = {
  id: "run1",
  agent_id: "ag1",
  agent_name: "Security Reviewer",
  ci_installation_id: "i1",
  repo: "acme/payments-api",
  pr_number: 42,
  commit_sha: "a".repeat(40),
  actions_run_id: 7,
  job_url: "https://github.com/acme/payments-api/actions/runs/7",
  verdict: "request_changes",
  status: "succeeded",
  error: null,
  findings_count: 3,
  cost_usd: 0.014,
  duration_ms: 1000,
  ran_at: "2026-10-01T12:00:00.000Z",
};

function installation(over: Partial<CiInstallation>): CiInstallation {
  return {
    id: "i1",
    agent_id: "ag1",
    repo: "acme/payments-api",
    target_type: "gha",
    installed_at: "2026-09-30T10:00:00.000Z",
    status: "active",
    workflow_version: 2,
    triggers: ["opened", "synchronize"],
    post_as: "github_review",
    pr_url: null,
    last_run: null,
    ...over,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: Error) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Route the two GETs the tab issues; each test picks what they return. */
function stubGets(installations: () => Promise<CiInstallation[]>, runs: () => Promise<CiRun[]> = async () => []) {
  apiGet.mockImplementation((path: string) => {
    if (path === "/agents/ag1/ci/installations") return installations();
    if (path === "/ci/runs?agent_id=ag1") return runs();
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiPut.mockReset();
});

afterEach(cleanup);

function renderTab() {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
        <CiTab agent={AGENT} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { user };
}

describe("CiTab", () => {
  it("loading hides the list and empty copy; an empty result shows the empty state, disables Update and says why; no history shows the no-runs note", async () => {
    const pending = deferred<CiInstallation[]>();
    stubGets(() => pending.promise);
    renderTab();

    expect(screen.queryByText(/This agent is not in CI yet/)).not.toBeInTheDocument();
    expect(screen.queryByText("Could not load CI installations.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update CI config" })).toBeDisabled();

    pending.resolve([]);
    expect(await screen.findByText(/This agent is not in CI yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update CI config" })).toBeDisabled();
    expect(screen.getByText("Add the agent to a repository first.")).toBeInTheDocument();
    expect(await screen.findByText("No CI runs for this agent yet.")).toBeInTheDocument();
  });

  it("an installations failure shows the error state and Retry refetches into the list", async () => {
    let calls = 0;
    stubGets(async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return [installation({})];
    });
    const { user } = renderTab();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load CI installations.");
    expect(screen.queryByText("acme/payments-api")).not.toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("acme/payments-api")).toBeInTheDocument();
    expect(screen.queryByText("Could not load CI installations.")).not.toBeInTheDocument();
  });

  it("lists installations with status and run history; Update CI config posts once and shows per-repo outcomes, resolving ids to repos", async () => {
    const results: CiUpdateResult = {
      results: [
        { installation_id: "i1", ok: true, pr_url: "https://github.com/acme/payments-api/pull/9", error: null },
        { installation_id: "i2", ok: false, pr_url: null, error: "branch is protected" },
      ],
    };
    stubGets(
      async () => [
        installation({ id: "i1", status: "active", last_run: RUN }),
        installation({ id: "i2", repo: "acme/web", status: "pr_open", workflow_version: 1 }),
      ],
      async () => [RUN],
    );
    apiPost.mockResolvedValue(results);
    const { user } = renderTab();

    expect(await screen.findByText("acme/web")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("PR open")).toBeInTheDocument();
    // Run history row (AC-59): PR number and verdict.
    const history = await screen.findByRole("table", { name: "Run history" });
    expect(within(history).getByText("#42")).toBeInTheDocument();
    expect(within(history).getByText("Request changes")).toBeInTheDocument();

    const update = screen.getByRole("button", { name: "Update CI config" });
    expect(update).toBeEnabled();
    expect(screen.getByText(/Any manual edits to the workflow are discarded/)).toBeInTheDocument();
    await user.click(update);

    const list = await screen.findByRole("list", { name: "Update results" });
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith("/agents/ag1/ci/update");
    const [ok, failed] = within(list).getAllByRole("listitem");
    expect(ok).toHaveTextContent("acme/payments-api");
    expect(ok).toHaveTextContent("Updated");
    expect(within(ok!).getByRole("link", { name: "View pull request" })).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/pull/9",
    );
    expect(failed).toHaveTextContent("acme/web");
    expect(failed).toHaveTextContent("Failed: branch is protected");
    expect(within(failed!).queryByRole("link")).not.toBeInTheDocument();
  });

  it("Update CI config stays disabled when no installation is a GitHub Actions one", async () => {
    stubGets(async () => [installation({ target_type: "circle" })]);
    renderTab();

    expect(await screen.findByText("acme/payments-api")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update CI config" })).toBeDisabled();
    expect(screen.getByText("Add the agent to a repository first.")).toBeInTheDocument();
  });

  it("a failed update request shows an alert", async () => {
    stubGets(async () => [installation({})]);
    apiPost.mockRejectedValue(new Error("GitHub is down"));
    const { user } = renderTab();

    await user.click(await screen.findByRole("button", { name: "Update CI config" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Update failed: GitHub is down");
  });

  it("Fail CI on: shows the pending value while saving; a rejected save reverts the select and raises an alert", async () => {
    stubGets(async () => []);
    const save = deferred<Agent>();
    apiPut.mockReturnValue(save.promise);
    const { user } = renderTab();

    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("critical");
    expect(screen.queryByText(/Could not save the setting/)).not.toBeInTheDocument();

    await user.selectOptions(select, "warning");
    expect(apiPut).toHaveBeenCalledWith("/agents/ag1", { ci_fail_on: "warning" });
    expect(select).toHaveValue("warning"); // pending value, not the server's

    save.reject(new Error("nope"));
    expect(await screen.findByText("Could not save the setting: nope")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save the setting: nope");
    await waitFor(() => expect(select).toHaveValue("critical")); // reverted
  });

  it("Add to CI opens the export wizard (AC-84)", async () => {
    stubGets(async () => []);
    const { user } = renderTab();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add to CI" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
