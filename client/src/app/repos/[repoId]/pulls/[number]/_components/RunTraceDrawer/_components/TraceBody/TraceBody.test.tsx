import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/runs.json";
import { TraceBody } from "./TraceBody";

afterEach(cleanup);

const SKILLS_BLOCK = "## Skills\n### Skill: secret-leakage-gate\nFlag hardcoded keys.\n\n### Skill: lethal-trifecta\nPrivate data + untrusted input + exfil.";

/** A trace written before spec 0006: no prompt_tokens, no skills_used. */
const OLD_TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, findings: 0, grounding: "0/0 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [],
  raw_output: "{}",
  memory_pulled: [],
  specs_read: [],
  log: [],
};

const NEW_TRACE: RunTrace = {
  ...OLD_TRACE,
  prompt_assembly: { ...OLD_TRACE.prompt_assembly, skills: SKILLS_BLOCK },
  skills_used: [
    { id: "s1", name: "secret-leakage-gate", version: 3, tokens: 12 },
    { id: "s2", name: "lethal-trifecta", version: 1, tokens: 15 },
  ],
  prompt_tokens: { system: 412, skills: 30, user: 900 },
};

function renderBody(trace: RunTrace) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <TraceBody trace={trace} findings={[]} />
    </NextIntlClientProvider>,
  );
}

const promptHeader = (label: string) => screen.getByText(label).closest<HTMLElement>("[role=button]")!;

describe("TraceBody prompt assembly", () => {
  it("shows per-block tokens and one sub-block per skill used", async () => {
    const user = userEvent.setup();
    renderBody(NEW_TRACE);
    await user.click(screen.getByText("Prompt assembly"));

    expect(within(promptHeader("System")).getByText("412 tok")).toBeInTheDocument();
    expect(within(promptHeader("User / diff (dynamic)")).getByText("900 tok")).toBeInTheDocument();

    const skills = screen.getByRole("group", { name: "Skills (system)" });
    expect(within(skills).getByText("30 tok")).toBeInTheDocument();
    expect(within(promptHeader("secret-leakage-gate · v3")).getByText("12 tok")).toBeInTheDocument();
    expect(within(promptHeader("lethal-trifecta · v1")).getByText("15 tok")).toBeInTheDocument();

    // each sub-block holds only its own skill's text
    await user.click(promptHeader("lethal-trifecta · v1"));
    expect(screen.getByText(/Private data \+ untrusted input/)).toBeInTheDocument();
    expect(screen.queryByText(/Flag hardcoded keys/)).not.toBeInTheDocument();
  });

  it("renders a trace written before skills_used / prompt_tokens existed", async () => {
    const user = userEvent.setup();
    renderBody(OLD_TRACE);
    await user.click(screen.getByText("Prompt assembly"));

    expect(promptHeader("System")).toBeInTheDocument();
    expect(promptHeader("Skills (system)")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Skills (system)" })).not.toBeInTheDocument();
    expect(screen.queryByText(/ tok$/)).not.toBeInTheDocument();
  });
});
