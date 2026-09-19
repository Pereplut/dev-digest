import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });
});

describe("FindingCard — Accept / Reject", () => {
  it("a collapsed card still shows Accept and Reject (no Dismiss wording)", () => {
    renderWithIntl(<FindingCard f={FINDING} onAction={() => {}} />);
    expect(screen.getByText("Accept")).toBeInTheDocument();
    expect(screen.getByText("Reject")).toBeInTheDocument();
    expect(screen.queryByText("Dismiss")).not.toBeInTheDocument();
    expect(screen.queryByText("Move the key to an environment variable.")).not.toBeInTheDocument();
  });

  it("fires accept / reject (dismiss) without toggling the card", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} onAction={onAction} />);
    // user.click runs the full pointer sequence, so a handler that stops
    // propagation to avoid toggling the card is actually exercised here.
    await user.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    await user.click(screen.getByText("Reject"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
    expect(screen.queryByText("Move the key to an environment variable.")).not.toBeInTheDocument();
  });

  it("Enter on a focused Accept button accepts instead of toggling the card", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} onAction={onAction} />);

    screen.getByRole("button", { name: "Accept" }).focus();
    await user.keyboard("{Enter}");
    expect(onAction).toHaveBeenCalledWith("accept");
    expect(screen.queryByText("Move the key to an environment variable.")).not.toBeInTheDocument();
  });

  it("a rejected finding is labelled rejected", () => {
    renderWithIntl(<FindingCard f={{ ...FINDING, dismissed_at: "2026-09-15T10:00:00Z" }} onAction={() => {}} />);
    expect(screen.getByText("rejected")).toBeInTheDocument();
  });
});
