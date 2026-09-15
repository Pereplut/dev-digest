import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RunCostBadge, formatUsd } from ".";

afterEach(cleanup);

describe("formatUsd", () => {
  it.each([
    [0.014, "$0.014"],
    [0.06, "$0.060"],
    [0.0149, "$0.015"],
    [1.5, "$1.500"],
    [0.00042, "$0.00042"],
    [0.0000013, "$0.0000013"],
    [0, "$0.000"],
    [null, "—"],
    [undefined, "—"],
    [-1, "—"],
    [Number.NaN, "—"],
  ])("%s → %s", (input, expected) => {
    expect(formatUsd(input as number | null | undefined)).toBe(expected);
  });
});

describe("RunCostBadge", () => {
  it("shows the cost of a done run", () => {
    render(<RunCostBadge costUsd={0.012} status="done" />);
    expect(screen.getByText("$0.012")).toBeInTheDocument();
  });

  it("shows — for a run without data, never $0.00", () => {
    render(<RunCostBadge costUsd={null} status="done" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it.each(["running", "failed", "cancelled", null])("hides the price of a %s run", (status) => {
    render(<RunCostBadge costUsd={0.5} status={status} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("marks a partial total with ≥ and a tooltip", () => {
    render(<RunCostBadge costUsd={0.014} partial partialTitle="Some runs have no cost data" />);
    const el = screen.getByText("≥$0.014");
    expect(el).toHaveAttribute("title", "Some runs have no cost data");
  });

  it("does not mark an unknown total as partial", () => {
    render(<RunCostBadge costUsd={null} partial partialTitle="x" />);
    expect(screen.getByText("—")).not.toHaveAttribute("title");
  });
});
