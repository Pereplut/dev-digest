import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentSkill, Skill } from "@devdigest/shared";
import type { SetAgentSkillsInput } from "@/lib/hooks/agents";
import messages from "../../../../../../../../messages/en/agents.json";
import { ToastProvider } from "@/lib/toast";

type MutateOptions = { onError?: (err: unknown) => void };

const h = vi.hoisted(() => {
  const skill = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    name: id,
    description: `${id} description`,
    type: "security" as const,
    source: "manual" as const,
    body: "body",
    enabled: true,
    version: 1,
    token_count: 100,
    ...over,
  });
  return {
    skills: [
      skill("secret-leakage-gate", { token_count: 120 }),
      skill("lethal-trifecta", { token_count: 80, type: "rubric" as const }),
      skill("phantom-api-gate", { enabled: false }),
    ],
    links: [] as unknown[],
  };
});

const mutate = vi.fn<(input: SetAgentSkillsInput, opts?: MutateOptions) => void>();

// Real useQuery over fixture data, so the component's optimistic cache writes
// show up exactly as they would against the API.
vi.mock("@/lib/hooks/agents", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    useAgentSkills: (agentId: string) =>
      useQuery({ queryKey: ["agent-skills", agentId], queryFn: async () => h.links }),
    useSetAgentSkills: () => ({ mutate, isPending: false }),
  };
});
vi.mock("@/lib/hooks/skills", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return { useSkills: () => useQuery({ queryKey: ["skills"], queryFn: async () => h.skills }) };
});

import { SkillsTab } from "./SkillsTab";

const SKILLS = h.skills as Skill[];
const link = (sk: Skill, order: number, enabled = true): AgentSkill => ({
  agent_id: "ag1",
  skill_id: sk.id,
  order,
  enabled,
  skill: sk,
});
const [SECRET, LETHAL] = SKILLS as [Skill, Skill, Skill];

beforeEach(() => {
  mutate.mockReset();
  h.links = [link(SECRET, 0), link(LETHAL, 1)];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks(); // the getBoundingClientRect spy
});

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        <ToastProvider>
          <SkillsTab agentId="ag1" />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/**
 * jsdom lays nothing out (every rect is 0×0), so dnd-kit's
 * sortableKeyboardCoordinates finds no row "below" the active one. Give each
 * list row (and anything inside it) a 40px-tall rect stacked by its index.
 */
function stubRowGeometry() {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const li = this.closest("li");
    const top = li?.parentElement ? Array.from(li.parentElement.children).indexOf(li) * 50 : 0;
    return { x: 0, y: top, top, left: 0, bottom: top + 40, right: 600, width: 600, height: 40, toJSON: () => ({}) };
  });
}

const lastPayload = () => mutate.mock.lastCall?.[0].skills;
const rowNames = () =>
  screen.getAllByRole("listitem").map((li) => within(li).getByRole("checkbox").closest("label")?.textContent);

describe("Agent Skills tab", () => {
  it("lists every workspace skill, counts what reaches the prompt, and saves check/uncheck as a full ordered list", async () => {
    const user = userEvent.setup();
    renderTab();

    expect(await screen.findByText("2 of 3 enabled")).toBeInTheDocument();
    expect(rowNames()).toEqual(["secret-leakage-gate", "lethal-trifecta", "phantom-api-gate"]);
    expect(screen.getByText("+≈200 tokens in the system prompt")).toBeInTheDocument();
    // the globally disabled skill is flagged as not reaching the prompt
    const phantomRow = screen.getAllByRole("listitem")[2]!;
    expect(within(phantomRow).getByText(/off globally/)).toBeInTheDocument();
    // unlinked rows can't be dragged — they have no prompt position yet
    expect(within(phantomRow).getByRole("button", { name: "Reorder phantom-api-gate" })).toBeDisabled();

    // checking an unlinked skill appends it enabled; globally off, so the count stays
    await user.click(screen.getByRole("checkbox", { name: "phantom-api-gate" }));
    expect(lastPayload()).toEqual([
      { skill_id: "secret-leakage-gate", enabled: true },
      { skill_id: "lethal-trifecta", enabled: true },
      { skill_id: "phantom-api-gate", enabled: true },
    ]);
    expect(screen.getByRole("checkbox", { name: "phantom-api-gate" })).toBeChecked();
    expect(screen.getByText("2 of 3 enabled")).toBeInTheDocument();

    // unchecking keeps the link (and its position) with enabled=false
    await user.click(screen.getByRole("checkbox", { name: "secret-leakage-gate" }));
    expect(lastPayload()).toEqual([
      { skill_id: "secret-leakage-gate", enabled: false },
      { skill_id: "lethal-trifecta", enabled: true },
      { skill_id: "phantom-api-gate", enabled: true },
    ]);
    expect(screen.getByText("1 of 3 enabled")).toBeInTheDocument();
    expect(screen.getByText("+≈80 tokens in the system prompt")).toBeInTheDocument();
    expect(mutate.mock.lastCall?.[0].agentId).toBe("ag1");
  });

  it("rolls the optimistic change back and toasts when saving fails", async () => {
    mutate.mockImplementation((_input, opts) => opts?.onError?.(new Error("boom")));
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole("checkbox", { name: "lethal-trifecta" }));
    expect(await screen.findByText(/Could not save this agent's skills/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "lethal-trifecta" })).toBeChecked();
    expect(screen.getByText("2 of 3 enabled")).toBeInTheDocument();
  });

  it("reorders linked skills from the keyboard via the drag handle, and disables dragging while filtering", async () => {
    stubRowGeometry();
    const user = userEvent.setup();
    renderTab();

    const handle = await screen.findByRole("button", { name: "Reorder secret-leakage-gate" });
    handle.focus();
    await user.keyboard("[Space]");
    await user.keyboard("[ArrowDown]");
    await user.keyboard("[Space]");
    await waitFor(() =>
      expect(lastPayload()).toEqual([
        { skill_id: "lethal-trifecta", enabled: true },
        { skill_id: "secret-leakage-gate", enabled: true },
      ]),
    );
    expect(rowNames()).toEqual(["lethal-trifecta", "secret-leakage-gate", "phantom-api-gate"]);

    await user.type(screen.getByRole("textbox", { name: "Filter skills…" }), "gate");
    expect(rowNames()).toEqual(["secret-leakage-gate", "phantom-api-gate"]);
    expect(screen.getByRole("button", { name: "Reorder secret-leakage-gate" })).toBeDisabled();
  });

  it("points to Skills Lab when the workspace has no skills", async () => {
    h.links = [];
    const saved = h.skills;
    h.skills = [];
    try {
      renderTab();
      expect(await screen.findByRole("link", { name: "create one in Skills Lab" })).toHaveAttribute("href", "/skills");
    } finally {
      h.skills = saved;
    }
  });
});
