import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
// Deliberately NOT through the `@devdigest/shared` alias: a VALUE import of it
// breaks `next build` (client/INSIGHTS.md:83-89, enforced by eslint). This is
// a static-shape assertion in a test file, so a direct relative read is safe —
// same reasoning as `src/test/eval-contract-parity.test.ts`.
import { FindingActionKind } from "../../../../../../../vendor/shared/contracts/findings";
import messages from "../../../../../../../../messages/en/prReview.json";
import evalsMessages from "../../../../../../../../messages/en/evals.json";

type MutateOptions = { onSuccess?: (data: unknown) => void; onError?: (err: unknown) => void };

const h = vi.hoisted(() => ({ isPending: false }));
const evalMutate = vi.fn<(input: { finding_id: string }, opts?: MutateOptions) => void>();

vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCase: () => ({ mutate: evalMutate, isPending: h.isPending }),
}));

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
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, evals: evalsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  evalMutate.mockReset();
  h.isPending = false;
});

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

describe("FindingCard — Turn into eval case (AC-48–52)", () => {
  const ACCEPTED: FindingRecord = { ...FINDING, accepted_at: "2026-09-15T10:00:00Z" };

  it("FindingActionKind gains no member (AC-49)", () => {
    expect(FindingActionKind.options).toEqual(["accept", "dismiss", "learn", "reply"]);
  });

  it("renders the control inside headerActions, disabled on an open finding (AC-52)", () => {
    renderWithIntl(<FindingCard f={FINDING} onAction={() => {}} />);
    const control = screen.getByRole("button", { name: "Turn into eval case" });
    expect(control).toBeDisabled();
  });

  // The disabled control used to give no reason at all, which is how a user
  // ends up reading the spec to find out that AC-25 derives the expectation
  // from the accept/dismiss verdict. The tooltip lives on a wrapper span
  // because a disabled <button> receives no pointer events, so a `title` on
  // the button itself would render nothing — assert the span, not the button.
  it("explains WHY the control is disabled on an open finding", () => {
    renderWithIntl(<FindingCard f={FINDING} onAction={() => {}} />);
    const control = screen.getByRole("button", { name: "Turn into eval case" });
    expect(control).toBeDisabled();
    const hint = control.closest("[title]");
    expect(hint, "the disabled control carries no explanatory title").not.toBeNull();
    expect(hint!.getAttribute("title")).toContain("Accept or dismiss this finding first");
  });

  // `title` is hover-only and a disabled <button> is out of the tab order —
  // neither reaches a keyboard or screen-reader user. The hint must also be
  // reachable WITHOUT hover: rendered as real text, and wired as the
  // control's accessible description via `aria-describedby`.
  it("the hint is reachable without hover — present as real text and the control's accessible description", () => {
    renderWithIntl(<FindingCard f={FINDING} onAction={() => {}} />);
    const control = screen.getByRole("button", { name: "Turn into eval case" });
    expect(screen.getByText(/Accept or dismiss this finding first/)).toBeInTheDocument();
    expect(control).toHaveAccessibleDescription(/Accept or dismiss this finding first/);
  });

  // Regression: the hint text used to live INSIDE the `role="button"` card
  // header (`:89` in FindingCard.tsx), whose accessible name is computed
  // from its own descendants' text (client/INSIGHTS.md:126-132) — so the
  // whole hint sentence was concatenated onto the expand/collapse toggle's
  // name on every open finding. `aria-describedby` resolves by id from
  // anywhere in the document, so the hint now sits OUTSIDE that header and
  // the wiring still holds (asserted by the test above).
  it("the hint text is not concatenated onto the expand/collapse toggle's accessible name", () => {
    renderWithIntl(<FindingCard f={FINDING} onAction={() => {}} />);
    const toggle = screen.getByRole("button", { expanded: false });
    // The DOM-level control: the sentence is not among the toggle's descendants.
    expect(within(toggle).queryByText(/Accept or dismiss this finding first/)).not.toBeInTheDocument();
    // The assertion that matches this test's name. The accessible name is
    // COMPUTED, not raw text, so a regression that reintroduced the sentence
    // via `aria-label` would leave `textContent` clean and still break every
    // screen reader — `toHaveAccessibleName` is the only matcher that sees it.
    expect(toggle).not.toHaveAccessibleName(/Accept or dismiss this finding first/);
  });

  it("drops the hint once the finding carries a verdict", () => {
    renderWithIntl(<FindingCard f={ACCEPTED} onAction={() => {}} />);
    const control = screen.getByRole("button", { name: "Turn into eval case" });
    expect(control).toBeEnabled();
    expect(control.closest("[title]")).toBeNull();
  });

  it("activating the control issues one POST via useCreateEvalCase and no finding-action request (AC-49)", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={ACCEPTED} onAction={onAction} />);
    await user.click(screen.getByRole("button", { name: "Turn into eval case" }));
    expect(evalMutate).toHaveBeenCalledTimes(1);
    expect(evalMutate.mock.calls[0]?.[0]).toEqual({ finding_id: "f1" });
    expect(onAction).not.toHaveBeenCalled();
  });

  it("on success renders the confirmation and disables the control (AC-50)", async () => {
    const user = userEvent.setup();
    evalMutate.mockImplementation((_input, opts) => opts?.onSuccess?.({ id: "case1" }));
    renderWithIntl(<FindingCard f={ACCEPTED} onAction={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Turn into eval case" }));
    const confirmed = screen.getByRole("button", { name: "Added as an eval case" });
    expect(confirmed).toBeDisabled();
  });

  it("on failure renders error.message inline and leaves the control enabled (AC-51)", async () => {
    const user = userEvent.setup();
    evalMutate.mockImplementation((_input, opts) => opts?.onError?.(new Error("That finding already has a case")));
    renderWithIntl(<FindingCard f={ACCEPTED} onAction={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Turn into eval case" }));
    expect(screen.getByText("Couldn't create eval case: That finding already has a case")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn into eval case" })).toBeEnabled();
  });

  it("a dismissed finding also enables the control", () => {
    renderWithIntl(
      <FindingCard f={{ ...FINDING, dismissed_at: "2026-09-15T10:00:00Z" }} onAction={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Turn into eval case" })).toBeEnabled();
  });
});
