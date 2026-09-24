import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import type { PrFile, PrReviewComment, SmartDiff } from "@/lib/types";
import messages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import { DiffTab } from "./DiffTab";

/**
 * Covers the acceptance criteria that only exist once the pieces are assembled:
 * group order, the collapsed roles, the two counters, and the Original-order
 * escape hatch. The pure parts are tested in helpers.test.ts and in
 * diff-viewer/findings.test.ts.
 *
 * Only the DATA hooks are mocked — the real DiffViewer, FileCard, CodeLine and
 * FindingCard render, so a break in the render-prop seam fails here.
 */

const smartDiffData = vi.hoisted(() => ({ current: undefined as SmartDiff | undefined }));
const commentsData = vi.hoisted(() => ({ current: [] as PrReviewComment[] }));
const findingAction = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false }));

vi.mock("@/lib/hooks/core", () => ({
  useSmartDiff: () => ({ data: smartDiffData.current }),
}));

vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: commentsData.current }),
  useCreatePrComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useFindingAction: () => findingAction,
}));

afterEach(cleanup);
beforeEach(() => {
  findingAction.mutate.mockClear();
  commentsData.current = [];
});

function comment(over: Partial<PrReviewComment> = {}): PrReviewComment {
  return {
    id: 1,
    path: "src/ratelimit.ts",
    line: 2,
    original_line: 2,
    side: "RIGHT",
    body: "looks risky",
    user: "u",
    created_at: "2026-01-01T00:00:00Z",
    html_url: "https://example.test",
    in_reply_to_id: null,
    is_outdated: false,
    ...over,
  };
}

function file(path: string, patch = "@@ -1,3 +1,3 @@\n x\n+y\n z"): PrFile {
  return { path, additions: 1, deletions: 0, patch };
}

const FILES: PrFile[] = [
  file("pnpm-lock.yaml"),
  file("src/ratelimit.ts"),
  file("README.md"),
  file("src/index.ts"),
  file("src/ratelimit.test.ts"),
];

function group(role: SmartDiff["groups"][number]["role"], paths: string[]) {
  return {
    role,
    files: paths.map((path) => ({ path, additions: 1, deletions: 0, finding_lines: [] })),
  };
}

/** Server order: core, tests, wiring, docs, boilerplate. */
const SMART: SmartDiff = {
  groups: [
    group("core", ["src/ratelimit.ts"]),
    group("tests", ["src/ratelimit.test.ts"]),
    group("wiring", ["src/index.ts"]),
    group("docs", ["README.md"]),
    group("boilerplate", ["pnpm-lock.yaml"]),
  ],
  split_suggestion: { too_big: false, total_lines: 10, proposed_splits: [] },
};

function finding(over: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key",
    file: "src/ratelimit.ts",
    start_line: 2,
    end_line: 2,
    rationale: "A live key is committed.",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  };
}

/**
 * Matches a role-group header by accessible name and nothing else — plain
 * `getAllByRole("button")` also returns every FileCard header and the
 * FindingCard controls.
 */
const GROUP_HEADER = /^(Core logic|Tests|Wiring|Docs|Boilerplate)/;

const roleLabelOf = (h: HTMLElement) => GROUP_HEADER.exec(h.textContent ?? "")?.[1];

function renderTab(props: Partial<React.ComponentProps<typeof DiffTab>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, shell: shellMessages }}>
      <DiffTab prId="p1" filesCount={FILES.length} files={FILES} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("DiffTab — grouping", () => {
  beforeEach(() => {
    smartDiffData.current = SMART;
  });

  it("shows the five role groups in reviewer order, collapsing docs and boilerplate", async () => {
    const user = userEvent.setup();
    renderTab();

    // ONE query, in DOCUMENT order. Querying expanded and collapsed separately
    // and concatenating would rebuild the expected order out of the query itself
    // and pass even if the groups rendered docs-first.
    const headers = screen.getAllByRole("button", { name: GROUP_HEADER });
    expect(headers.map(roleLabelOf)).toEqual([
      "Core logic",
      "Tests",
      "Wiring",
      "Docs",
      "Boilerplate",
    ]);

    // Each header carries its file count, and only docs/boilerplate start closed.
    expect(headers.map((h) => h.getAttribute("aria-expanded"))).toEqual([
      "true",
      "true",
      "true",
      "false",
      "false",
    ]);
    expect(screen.getAllByText("1 files").length).toBe(5);

    // The lock file is inside the collapsed group, and expanding reveals it.
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Boilerplate/ }));
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
  });

  it("renders a file no group claimed rather than dropping it", () => {
    smartDiffData.current = { ...SMART, groups: [group("core", ["src/ratelimit.ts"])] };
    renderTab();
    // Everything else falls into the unlabelled leftovers section.
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
  });
});

describe("DiffTab — Original order", () => {
  beforeEach(() => {
    smartDiffData.current = SMART;
  });

  it("drops the grouping and shows GitHub's order", () => {
    renderTab({ order: "original" });
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    const paths = screen.getAllByText(/pnpm-lock\.yaml|src\/|README\.md/).map((n) => n.textContent);
    expect(paths).toEqual([
      "pnpm-lock.yaml",
      "src/ratelimit.ts",
      "README.md",
      "src/index.ts",
      "src/ratelimit.test.ts",
    ]);
  });

  it("asks the page to write the choice to the URL", async () => {
    const user = userEvent.setup();
    const onSetOrder = vi.fn();
    renderTab({ onSetOrder });
    await user.click(screen.getByRole("button", { name: "Original order" }));
    expect(onSetOrder).toHaveBeenCalledWith("original");
  });

  it("falls back to GitHub's order when the route returned nothing", () => {
    smartDiffData.current = undefined;
    renderTab();
    expect(screen.queryByText("Core logic")).not.toBeInTheDocument();
    expect(screen.getByText("src/ratelimit.ts")).toBeInTheDocument();
  });
});

describe("DiffTab — findings", () => {
  beforeEach(() => {
    smartDiffData.current = SMART;
  });

  it("counts FILES with findings on the group header, not findings", () => {
    smartDiffData.current = {
      ...SMART,
      groups: [group("core", ["src/ratelimit.ts", "src/index.ts"])],
    };
    renderTab({
      files: [file("src/ratelimit.ts"), file("src/index.ts")],
      findings: [
        finding({ id: "a", start_line: 2 }),
        finding({ id: "b", start_line: 2 }),
        finding({ id: "c", file: "src/index.ts", start_line: 2 }),
      ],
    });
    const header = screen.getByRole("button", { name: /^Core logic/ });
    expect(within(header).getByLabelText("2 file(s) with findings")).toBeInTheDocument();
  });

  it("marks a file that has findings with a dot", () => {
    renderTab({ findings: [finding()] });
    expect(screen.getByLabelText("1 finding(s) in this file")).toBeInTheDocument();
  });

  it("renders the finding under its line, with its severity and explanation", () => {
    renderTab({ findings: [finding()] });
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
    expect(screen.getByText("A live key is committed.")).toBeInTheDocument();
    expect(screen.getByText("blocker")).toBeInTheDocument();
  });

  it("lists a finding whose line is not in the patch at the foot of the file", () => {
    renderTab({ findings: [finding({ start_line: 900 })] });
    expect(screen.getByText("1 finding(s) outside this patch")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
  });

  it("Accept sends the action for that finding", async () => {
    const user = userEvent.setup();
    renderTab({ findings: [finding()] });
    // Exact name, not /Accept/: FindingCard's header is itself a role="button"
    // wrapping these controls, so its accessible name contains "Accept" too.
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(findingAction.mutate).toHaveBeenCalledWith({
      findingId: "f1",
      action: "accept",
      prId: "p1",
    });
  });

  it("one button hides findings and offers to show them again; the dot survives", async () => {
    const user = userEvent.setup();
    renderTab({ findings: [finding()] });
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Hide comments & findings/ }));
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
    // The marker stays: a dot that vanished would read as "the findings are gone".
    expect(screen.getByLabelText("1 finding(s) in this file")).toBeInTheDocument();

    // The POSITIVE label, so the "no button" assertion below is known to be able
    // to fail — it renders only once something is hidden.
    const show = screen.getByRole("button", { name: /Show comments & findings/ });
    await user.click(show);
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
  });

  it("keeps comments hidden by default on a PR with no findings, and shows them in ONE click", async () => {
    // The regression this guards: while two booleans backed one button, `anyShown`
    // was true on first paint because findings default to shown, so this button
    // read "Hide comments" over a hidden comment and the first click did nothing.
    const user = userEvent.setup();
    commentsData.current = [comment()];
    renderTab({ findings: [] });

    expect(screen.queryByText("looks risky")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Show comments/ }));
    expect(screen.getByText("looks risky")).toBeInTheDocument();
  });

  it("offers no visibility button before a review, with no comments either", () => {
    renderTab({ findings: [] });
    // Matches EITHER label: with no findings the button would read "Show
    // comments", and asserting only the wording the component never shows first
    // would make this pass however the guard breaks.
    expect(screen.queryByRole("button", { name: /comments/i })).not.toBeInTheDocument();
    // Grouping still works with no review at all.
    expect(screen.getByText("Core logic")).toBeInTheDocument();
  });
});
