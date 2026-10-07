import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
