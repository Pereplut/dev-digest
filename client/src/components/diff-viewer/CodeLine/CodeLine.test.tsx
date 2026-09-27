import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/shell.json";
import type { Line } from "../helpers";
import type { DiffFindingApi, DiffFindingLike } from "../findings";
import { CodeLine } from "./CodeLine";

/**
 * The severity STRIPE is the one piece of the finding presentation that no other
 * test reaches — DiffTab's flow asserts the label and the card, but a border is
 * not queryable through a role or a text node, so it needs a test here.
 */

afterEach(cleanup);

const LINE: Line = { kind: "add", text: "const key = bucketKey(req);", newNo: 28 };

function finding(over: Partial<DiffFindingLike> = {}): DiffFindingLike {
  return { id: "f1", file: "src/a.ts", start_line: 28, severity: "CRITICAL", ...over };
}

function api(over: Partial<DiffFindingApi> = {}): DiffFindingApi {
  return {
    findings: [finding()],
    showFindings: true,
    render: (f) => <div data-testid="card">{f.id}</div>,
    ...over,
  };
}

function renderLine(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/**
 * The row asserts through `data-severity`, not through its inline style: which
 * CSS token paints which severity is styles.ts's business, and a test keyed on
 * the style string could not tell "this line has no stripe" from "the selector
 * no longer matches".
 */
const row = () => screen.getByTestId("code-row");

describe("CodeLine — the severity stripe and label", () => {
  it("marks a line that carries a finding with its severity", () => {
    renderLine(
      <CodeLine ln={LINE} path="src/a.ts" threads={[]} lineFindings={[finding()]} findings={api()} />,
    );
    expect(row()).toHaveAttribute("data-severity", "CRITICAL");
  });

  it("uses the WORST severity when a line carries several", () => {
    const both = [finding({ id: "a", severity: "SUGGESTION" }), finding({ id: "b", severity: "WARNING" })];
    renderLine(
      <CodeLine ln={LINE} path="src/a.ts" threads={[]} lineFindings={both} findings={api({ findings: both })} />,
    );
    expect(row()).toHaveAttribute("data-severity", "WARNING");
  });

  it("labels the line blocker / warning / suggestion, not the badge wording", () => {
    renderLine(
      <CodeLine ln={LINE} path="src/a.ts" threads={[]} lineFindings={[finding()]} findings={api()} />,
    );
    expect(screen.getByText("blocker")).toBeInTheDocument();
    expect(screen.queryByText("Critical")).not.toBeInTheDocument();
  });

  it("leaves a line with no finding unmarked and unlabelled", () => {
    // The row always renders; what must be absent is the severity marking.
    renderLine(
      <CodeLine ln={LINE} path="src/a.ts" threads={[]} lineFindings={[]} findings={api({ findings: [] })} />,
    );
    expect(row()).not.toHaveAttribute("data-severity");
    expect(screen.queryByText("blocker")).not.toBeInTheDocument();
  });

  it("keeps the marking and the label when the cards are hidden, but drops the card", () => {
    // The marker must survive the visibility toggle — a line that lost its stripe
    // would read as "this finding went away".
    renderLine(
      <CodeLine
        ln={LINE}
        path="src/a.ts"
        threads={[]}
        lineFindings={[finding()]}
        findings={api({ showFindings: false })}
      />,
    );
    expect(row()).toHaveAttribute("data-severity", "CRITICAL");
    expect(screen.getByText("blocker")).toBeInTheDocument();
    expect(screen.queryByTestId("card")).not.toBeInTheDocument();
  });

  it("renders the caller's node under the row when findings are shown", () => {
    renderLine(
      <CodeLine ln={LINE} path="src/a.ts" threads={[]} lineFindings={[finding()]} findings={api()} />,
    );
    // getByTestId throws on a second match, so this also proves it rendered once.
    expect(screen.getByTestId("card")).toHaveTextContent("f1");
  });
});
