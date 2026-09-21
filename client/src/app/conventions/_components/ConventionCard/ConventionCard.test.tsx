import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeCandidate, renderWithProviders } from "../../_lib/test-utils";
import { ConventionCard } from "./ConventionCard";
import { confidenceColor, formatLocation, rejectReasonKey } from "./helpers";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup(candidate = makeCandidate()) {
  const onAccept = vi.fn<() => void>();
  const onReject = vi.fn<() => void>();
  const onEditRule = vi.fn<(rule: string) => void>();
  renderWithProviders(
    <ConventionCard
      candidate={candidate}
      onAccept={onAccept}
      onReject={onReject}
      onEditRule={onEditRule}
    />,
  );
  return { onAccept, onReject, onEditRule, user: userEvent.setup() };
}

describe("ConventionCard", () => {
  it("shows the rule, its category and the verified evidence", () => {
    setup();
    expect(
      screen.getByText("Always use async/await instead of .then() chains"),
    ).toBeInTheDocument();
    expect(screen.getByText("async")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:23-31")).toBeInTheDocument();
    expect(screen.getByText(/const user = await db\.users\.find\(id\)/)).toBeInTheDocument();
  });

  it("renders the confidence as a percentage", () => {
    setup();
    expect(screen.getByText("91%")).toBeInTheDocument();
  });

  it("calls onAccept when Accept is pressed", async () => {
    const { onAccept, user } = setup();
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("reads 'Accepted' once the candidate is accepted", () => {
    setup(makeCandidate({ status: "accepted" }));
    expect(screen.getByRole("button", { name: /Accepted/ })).toBeInTheDocument();
  });

  it("calls onReject when Reject is pressed", async () => {
    const { onReject, user } = setup();
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("submits an edited rule", async () => {
    const { onEditRule, user } = setup();
    await user.click(screen.getByRole("button", { name: "Edit rule" }));
    const input = screen.getByRole("textbox", { name: "Rule" });
    await user.clear(input);
    await user.type(input, "Prefer await over promise chains");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onEditRule).toHaveBeenCalledWith("Prefer await over promise chains");
  });

  it("does not call onEditRule when the edit is cancelled", async () => {
    const { onEditRule, user } = setup();
    await user.click(screen.getByRole("button", { name: "Edit rule" }));
    await user.type(screen.getByRole("textbox", { name: "Rule" }), " more");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onEditRule).not.toHaveBeenCalled();
  });

  it("explains why unverified evidence was rejected", () => {
    setup(
      makeCandidate({
        status: "rejected",
        evidence_valid: false,
        rejected_reason: "snippet_not_found",
      }),
    );
    expect(screen.getByText("That code is not at the cited lines.")).toBeInTheDocument();
  });
});

describe("ConventionCard helpers", () => {
  it("colours confidence on the same thresholds as the kit's ConfidenceNum", () => {
    expect(confidenceColor(0.91)).toBe("var(--ok)");
    expect(confidenceColor(0.78)).toBe("var(--warn)");
    expect(confidenceColor(0.4)).toBe("var(--text-muted)");
    // Boundaries.
    expect(confidenceColor(0.85)).toBe("var(--ok)");
    expect(confidenceColor(0.65)).toBe("var(--warn)");
  });

  it("formats a location", () => {
    expect(formatLocation(makeCandidate())).toBe("src/api/users.ts:23-31");
    expect(
      formatLocation(makeCandidate({ evidence_start_line: 9, evidence_end_line: 9 })),
    ).toBe("src/api/users.ts:9");
    expect(formatLocation(makeCandidate({ evidence_start_line: null }))).toBe("src/api/users.ts");
  });

  it("maps only known rejection reasons to a key", () => {
    expect(rejectReasonKey("file_not_found")).toBe("card.reason.file_not_found");
    expect(rejectReasonKey("something_else")).toBeNull();
    expect(rejectReasonKey(null)).toBeNull();
  });
});
