import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@/lib/types";
import messages from "../../../../messages/en/shell.json";
import { FileCard } from "./FileCard";

/**
 * `defaultOpen` is the prop Smart Diff uses to collapse a whole role, and it has
 * to BEAT the auto-expand heuristic — a two-line file inside `boilerplate` must
 * still arrive closed. Nothing else asserts that: DiffTab's test only checks that
 * a path appears once its GROUP is expanded, which a card open by default would
 * also satisfy.
 */

afterEach(cleanup);

/** Three changed lines — far under AUTO_EXPAND_MAX_LINES, so it auto-expands. */
function tinyFile(): PrFile {
  return {
    path: "src/a.ts",
    additions: 2,
    deletions: 1,
    // The sign and the text render in separate spans, so assert on the text alone.
    patch: "@@ -1,2 +1,3 @@\n ctx\n+const added = 1;\n more",
  };
}

function renderCard(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ shell: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FileCard — defaultOpen vs the auto-expand heuristic", () => {
  it("auto-expands a small file when defaultOpen is not given", () => {
    renderCard(<FileCard file={tinyFile()} />);
    expect(screen.getByRole("button", { name: /src\/a\.ts/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("const added = 1;")).toBeInTheDocument();
  });

  it("stays collapsed when defaultOpen is false, small though it is", () => {
    renderCard(<FileCard file={tinyFile()} defaultOpen={false} />);
    expect(screen.getByRole("button", { name: /src\/a\.ts/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // The body is not rendered at all, so no code line is present.
    expect(screen.queryByText("const added = 1;")).not.toBeInTheDocument();
  });

  it("opens a large file when defaultOpen is true, overriding the heuristic the other way", () => {
    const big: PrFile = { ...tinyFile(), additions: 9999, deletions: 0 };

    // The control first: without the prop this file is far over
    // AUTO_EXPAND_MAX_LINES and must arrive closed. Without this half, the
    // assertion below could not tell "defaultOpen won" from "the heuristic would
    // have opened it anyway".
    renderCard(<FileCard file={big} />);
    expect(screen.getByRole("button", { name: /src\/a\.ts/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    cleanup();

    renderCard(<FileCard file={big} defaultOpen />);
    expect(screen.getByRole("button", { name: /src\/a\.ts/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});
