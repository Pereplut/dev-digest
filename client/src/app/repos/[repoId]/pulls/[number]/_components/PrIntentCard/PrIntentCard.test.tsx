/**
 * PrIntentCard (spec 0008).
 *
 * The two things worth pinning: nothing renders when there is no intent (the
 * classifier is fail-open, so that is the normal case), and the confidence band
 * is readable as TEXT — not signalled by colour, which a greyscale screen or a
 * screen reader would lose.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PrIntentRecord } from "@devdigest/shared";
import { PrIntentCard } from "./PrIntentCard";

const mockIntent = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  usePrIntent: () => mockIntent() as { data: PrIntentRecord | null },
}));
vi.mock("next-intl", () => ({
  // Render the key plus any interpolation, so assertions read against a stable
  // string without depending on the copy in messages/en.
  useTranslations: () => (key: string, vars?: Record<string, string>) =>
    vars ? `${key}:${Object.values(vars).join(",")}` : key,
}));

const base: PrIntentRecord = {
  pr_id: "pr-1",
  intent: "Add a readiness probe so orchestrators stop routing to a booting instance.",
  in_scope: ["server/src/app.ts"],
  out_of_scope: ["the client"],
  category: "feature",
  confidence: "high",
  rationale: null,
  sources: [
    { kind: "body", ref: "body", chars: 120, truncated: false, status: "used" },
    { kind: "spec", ref: "specs/0008.md", chars: 400, truncated: false, status: "used" },
  ],
  evidence: [
    { source_kind: "spec", ref: "specs/0008.md", quote: "readiness probe", valid: true },
  ],
  head_sha: "abc",
  model: "gpt-4.1-mini",
  cost_usd: 0.0032,
  derived_at: "2026-09-23T12:00:00.000Z",
};

const withIntent = (over: Partial<PrIntentRecord> = {}) =>
  mockIntent.mockReturnValue({ data: { ...base, ...over } });

describe("PrIntentCard", () => {
  beforeEach(() => mockIntent.mockReset());

  it("renders nothing when there is no intent", () => {
    mockIntent.mockReturnValue({ data: null });
    const { container } = render(<PrIntentCard prId="pr-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the category and the purpose", () => {
    withIntent();
    render(<PrIntentCard prId="pr-1" />);
    expect(screen.getByText("intent.category.feature")).toBeInTheDocument();
    expect(screen.getByText(/readiness probe so orchestrators/)).toBeInTheDocument();
  });

  /** The band must be legible without colour. */
  it("spells the confidence band out in text", () => {
    withIntent({ confidence: "low" });
    render(<PrIntentCard prId="pr-1" />);
    expect(screen.getByText("intent.confidenceLabel:intent.confidence.low")).toBeInTheDocument();
  });

  it("explains a low band and stays quiet on a high one", () => {
    withIntent({ confidence: "low" });
    const { unmount } = render(<PrIntentCard prId="pr-1" />);
    expect(screen.getByText("intent.lowConfidenceHint")).toBeInTheDocument();
    unmount();

    withIntent({ confidence: "high" });
    render(<PrIntentCard prId="pr-1" />);
    expect(screen.queryByText("intent.lowConfidenceHint")).not.toBeInTheDocument();
  });

  it("lists in-scope and out-of-scope items", () => {
    withIntent();
    render(<PrIntentCard prId="pr-1" />);
    expect(screen.getByText("server/src/app.ts")).toBeInTheDocument();
    expect(screen.getByText("the client")).toBeInTheDocument();
  });

  it("marks an unreadable spec instead of dropping it", () => {
    withIntent({
      confidence: "medium",
      sources: [
        { kind: "body", ref: "body", chars: 10, truncated: false, status: "used" },
        { kind: "spec", ref: "docs/plan.md", chars: 0, truncated: false, status: "unreadable" },
      ],
    });
    render(<PrIntentCard prId="pr-1" />);
    expect(screen.getByText("intent.sources.unreadable:docs/plan.md")).toBeInTheDocument();
  });

  it("flags a quote the server could not verify", () => {
    withIntent({
      evidence: [
        { source_kind: "body", ref: "body", quote: "invented", valid: false },
        { source_kind: "spec", ref: "specs/0008.md", quote: "real one", valid: true },
      ],
    });
    render(<PrIntentCard prId="pr-1" />);
    expect(screen.getByText("intent.evidence.unverified", { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText(/“/)).toHaveLength(2);
  });

  it("names the model that produced it", () => {
    withIntent();
    render(<PrIntentCard prId="pr-1" />);
    expect(screen.getByText("intent.derivedWith:gpt-4.1-mini")).toBeInTheDocument();
  });
});
