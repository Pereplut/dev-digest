import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import evalsMessages from "../../../../../../messages/en/evals.json";
import { ToastProvider } from "../../../../../lib/toast";
import { TABS } from "./constants";

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
  useAgentSkills: () => ({ data: [], isError: false }),
  useSetAgentSkills: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: [], isError: false }),
}));
vi.mock("../../../../../lib/hooks/evals", () => ({
  useAgentEvalCases: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useAgentEvalBatches: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useAgentEvalDashboard: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
  useEvalCompare: () => ({ data: undefined, isLoading: false, isError: false }),
  useEvalBatch: () => ({ data: undefined }),
  useRunEvals: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../../../../lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import { AgentEditor } from "./AgentEditor";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
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

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={{ agents: messages, evals: evalsMessages }}>
        <ToastProvider>{ui}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });

  it("renders the Skills tab when tab=skills", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="skills" onTab={() => {}} />);
    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "create one in Skills Lab" })).toBeInTheDocument();
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
  });

  it("TABS carries an evals entry resolving against the pre-existing agents.json key (AC-53, AC-54)", () => {
    const evalsTab = TABS.find((tb) => tb.key === "evals");
    expect(evalsTab).toEqual({ key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" });
    expect(messages.editor.tabs.evals).toBe("Evals");
    // No second key for the same label was added to evals.json.
    expect("tabs" in evalsMessages).toBe(false);
  });

  it("renders the Evals tab when tab=evals, using the agents.json tab label as its title", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="evals" onTab={() => {}} />);
    expect(screen.getByRole("heading", { name: "Evals" })).toBeInTheDocument();
    expect(screen.queryByText("Configuration")).not.toBeInTheDocument();
  });
});
