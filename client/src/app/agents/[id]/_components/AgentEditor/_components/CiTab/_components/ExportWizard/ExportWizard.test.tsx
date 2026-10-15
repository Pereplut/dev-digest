import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { CiExport, CiExportInputBody, CiFile } from "@devdigest/shared";
import ciMessages from "../../../../../../../../../../messages/en/ci.json";

/**
 * ExportWizard (spec 0022: AC-61..AC-66, AC-81, AC-83).
 *
 * Boundaries mocked: the data hooks (`useExportCi`, `useRepos`) and the active
 * repo context, plus a stubbed global `fetch` that must stay untouched. The
 * component, the vendored Modal / steps / form kit and the i18n catalogue are
 * real. msw is not installed, so the export endpoint is a recorded `vi.fn`.
 */

const WORKFLOW_PATH = ".github/workflows/devdigest-review.yml";
const MANIFEST_PATH = ".devdigest/agents/security-reviewer.yaml";
const SKILL_PATH = ".devdigest/skills/lint-rules.md";
const MEMORY_PATH = ".devdigest/memory.jsonl";
const RUNNER_PATH = ".devdigest/runner/index.js";
const PR_URL = "https://github.com/acme/payments-api/pull/9";

const { exportCi, repoContext } = vi.hoisted(() => ({
  exportCi: vi.fn(),
  repoContext: { activeRepo: { id: "r1", full_name: "acme/payments-api" } as { id: string; full_name: string } | null },
}));

vi.mock("@/lib/hooks/ci", () => ({
  useExportCi: () => ({ mutateAsync: exportCi, isPending: false }),
}));
vi.mock("@/lib/hooks", () => ({
  useRepos: () => ({
    data: [
      { id: "r1", full_name: "acme/payments-api" },
      { id: "r2", full_name: "acme/web" },
    ],
  }),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: repoContext.activeRepo }),
}));

import { ExportWizard } from "./ExportWizard";

/** The workflow the fake endpoint returns: it reflects the request, like the real generator. */
function workflowFor(body: CiExportInputBody): string {
  return `name: DevDigest Review\non:\n  pull_request:\n    types: [${(body.triggers ?? []).join(", ")}]\n# post_as: ${body.post_as}\n`;
}

function filesFor(body: CiExportInputBody): CiFile[] {
  return [
    { path: MANIFEST_PATH, contents: 'name: "Security Reviewer"\n', editable: false },
    { path: SKILL_PATH, contents: "# Lint rules\n", editable: false },
    { path: MEMORY_PATH, contents: "", editable: false },
    { path: RUNNER_PATH, contents: "// runner\n", editable: false },
    { path: WORKFLOW_PATH, contents: workflowFor(body), editable: true },
  ];
}

const fetchSpy = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  exportCi.mockReset();
  exportCi.mockImplementation(async (body: CiExportInputBody): Promise<CiExport> => ({
    installation: null,
    files: filesFor(body),
    pr_url: body.action === "open_pr" ? PR_URL : null,
  }));
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  repoContext.activeRepo = { id: "r1", full_name: "acme/payments-api" };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  onClose.mockReset();
});

function renderWizard() {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
      <ExportWizard agentId="ag1" agentName="Security Reviewer" onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return { user, dialog: screen.getByRole("dialog") };
}

const body = (call: number): CiExportInputBody => exportCi.mock.calls[call]![0] as CiExportInputBody;

describe("ExportWizard", () => {
  it("opens on Target with four steps and one target; Preview lists the files and only the workflow is editable; an edit reaches the open_pr body; Configure defaults match; no secrets request (AC-61..AC-66)", async () => {
    const { user, dialog } = renderWizard();

    // AC-61: four steps, Target is the active (bold) one.
    const labels = ["Target", "Preview", "Configure", "Install"];
    for (const label of labels) expect(within(dialog).getByText(label)).toBeInTheDocument();
    expect(within(dialog).getByText("Target")).toHaveStyle({ fontWeight: "600" });
    for (const label of labels.slice(1)) expect(within(dialog).getByText(label)).toHaveStyle({ fontWeight: "500" });

    // AC-62: exactly one target option, and no other CI systems.
    const targets = within(within(dialog).getByRole("radiogroup", { name: "CI target" })).getAllByRole("radio");
    expect(targets).toHaveLength(1);
    expect(targets[0]).toHaveTextContent("GitHub Actions");
    expect(dialog).not.toHaveTextContent(/CircleCI|Jenkins|Generic CLI/i);

    // Target -> Preview: one files-only request.
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await within(dialog).findByRole("button", { name: MANIFEST_PATH })).toBeInTheDocument();
    expect(exportCi).toHaveBeenCalledTimes(1);
    expect(body(0)).toMatchObject({ action: "files", target: "gha", repo: "acme/payments-api" });
    expect(body(0)).not.toHaveProperty("workflow_override");

    // AC-63: every fixture path is listed; only the workflow is editable.
    for (const path of [MANIFEST_PATH, SKILL_PATH, MEMORY_PATH, RUNNER_PATH, WORKFLOW_PATH]) {
      expect(within(dialog).getByRole("button", { name: path })).toBeInTheDocument();
    }
    const editor = within(dialog).getByRole("textbox");
    expect(editor).toHaveValue(workflowFor(body(0)));
    expect(within(dialog).getByText("editable")).toBeInTheDocument();
    for (const readOnlyPath of [MANIFEST_PATH, SKILL_PATH, MEMORY_PATH, RUNNER_PATH]) {
      await user.click(within(dialog).getByRole("button", { name: readOnlyPath }));
      expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
      expect(within(dialog).getByText("read-only")).toBeInTheDocument();
    }

    // AC-64: edit the workflow; the edited text is what open_pr sends.
    await user.click(within(dialog).getByRole("button", { name: WORKFLOW_PATH }));
    const textarea = within(dialog).getByRole("textbox");
    await user.type(textarea, "# edited by hand");
    const edited = workflowFor(body(0)) + "# edited by hand";
    expect(textarea).toHaveValue(edited);

    // AC-65: Configure defaults.
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(within(dialog).getByRole("switch", { name: /^Opened$/ })).toBeChecked();
    expect(within(dialog).getByRole("switch", { name: /^Synchronize/ })).toBeChecked();
    expect(within(dialog).getByRole("switch", { name: /^Reopened$/ })).not.toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /^GitHub review/ })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /^PR comment/ })).not.toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /^None/ })).not.toBeChecked();

    // AC-66: the secrets panel is instructions only.
    expect(within(dialog).getByText("OPENROUTER_API_KEY")).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(/not set|\bready\b|is set\b/i);

    // Install: exactly one open_pr request carrying the edited text.
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    await user.click(within(dialog).getByRole("button", { name: "Open pull request" }));
    expect(await within(dialog).findByText("Pull request opened")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "View pull request" })).toHaveAttribute("href", PR_URL);

    const openPrCalls = exportCi.mock.calls.filter(([b]) => (b as CiExportInputBody).action === "open_pr");
    expect(openPrCalls).toHaveLength(1);
    expect(openPrCalls[0]![0]).toEqual({
      repo: "acme/payments-api",
      target: "gha",
      action: "open_pr",
      post_as: "github_review",
      triggers: ["opened", "synchronize"],
      workflow_override: edited,
    });

    // AC-66: the wizard never asked the network about secrets (nor anything else).
    expect(fetchSpy.mock.calls.filter((c) => /secret/i.test(String(c[0])))).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("AC-64 (negative): an unedited workflow sends open_pr with no workflow_override", async () => {
    const { user, dialog } = renderWizard();
    await user.click(within(dialog).getByRole("button", { name: "Continue" })); // -> Preview
    await within(dialog).findByRole("textbox");
    await user.click(within(dialog).getByRole("button", { name: "Continue" })); // -> Configure
    await user.click(within(dialog).getByRole("button", { name: "Continue" })); // -> Install
    await user.click(within(dialog).getByRole("button", { name: "Open pull request" }));
    await within(dialog).findByText("Pull request opened");

    const openPr = body(exportCi.mock.calls.length - 1);
    expect(openPr.action).toBe("open_pr");
    expect(openPr).not.toHaveProperty("workflow_override");
  });

  it("AC-81: an unedited Preview follows the Configure choices; after an edit the YAML stays byte-identical and a notice is shown", async () => {
    const { user, dialog } = renderWizard();
    await user.click(within(dialog).getByRole("button", { name: "Continue" })); // -> Preview
    expect(await within(dialog).findByRole("textbox")).toHaveValue(workflowFor(body(0)));
    expect(workflowFor(body(0))).toContain("types: [opened, synchronize]");

    // Unedited: switching "Reopened" on regenerates the preview.
    await user.click(within(dialog).getByRole("button", { name: "Continue" })); // -> Configure
    expect(within(dialog).queryByRole("status")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("switch", { name: /^Reopened$/ }));
    await waitFor(() => expect(exportCi).toHaveBeenCalledTimes(2));
    expect(body(1).triggers).toEqual(["opened", "synchronize", "reopened"]);
    await user.click(within(dialog).getByRole("button", { name: "Back" })); // -> Preview
    const regenerated = workflowFor(body(1));
    await waitFor(() => expect(within(dialog).getByRole("textbox")).toHaveValue(regenerated));
    expect(regenerated).toContain("types: [opened, synchronize, reopened]");

    // Edit, then change the same control again: no new request, YAML untouched, notice shown.
    await user.type(within(dialog).getByRole("textbox"), "# hand edit");
    const edited = regenerated + "# hand edit";
    expect(within(dialog).getByRole("textbox")).toHaveValue(edited);

    await user.click(within(dialog).getByRole("button", { name: "Continue" })); // -> Configure
    expect(within(dialog).getByRole("status")).toHaveTextContent(/you edited the workflow/i);
    await user.click(within(dialog).getByRole("switch", { name: /^Reopened$/ }));
    await user.click(within(dialog).getByRole("radio", { name: /^PR comment/ }));
    expect(exportCi).toHaveBeenCalledTimes(2); // no regeneration request after the edit
    await user.click(within(dialog).getByRole("button", { name: "Back" })); // -> Preview
    expect(within(dialog).getByRole("textbox")).toHaveValue(edited);
    expect(edited).not.toContain("post_as: pr_comment");
  });

  it("AC-83: the repository is prefilled with the active repo's full_name; not-a-repo disables Continue and acme/x enables it", async () => {
    const { user, dialog } = renderWizard();
    const input = within(dialog).getByRole("combobox", { name: "Target repository" });
    const next = within(dialog).getByRole("button", { name: "Continue" });

    expect(input).toHaveValue("acme/payments-api");
    expect(next).toBeEnabled();

    await user.clear(input);
    await user.type(input, "not-a-repo");
    expect(next).toBeDisabled();
    expect(within(dialog).getByRole("alert")).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "acme/x");
    expect(next).toBeEnabled();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();

    // The typed repo is what the export request targets.
    await user.click(next);
    await waitFor(() => expect(exportCi).toHaveBeenCalledTimes(1));
    expect(body(0).repo).toBe("acme/x");
  });

  it("AC-83 (no active repo): the field starts empty and Continue is disabled until a valid owner/name is typed", async () => {
    repoContext.activeRepo = null;
    const { user, dialog } = renderWizard();
    const input = within(dialog).getByRole("combobox", { name: "Target repository" });
    expect(input).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument(); // empty is not "invalid"
    await user.type(input, "acme/web");
    expect(within(dialog).getByRole("button", { name: "Continue" })).toBeEnabled();
  });
});
