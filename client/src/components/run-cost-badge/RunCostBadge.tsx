/* RunCostBadge — USD cost of a review run (or a PR's latest review round).
   Used by the PR list COST column and the PR Timeline. Pure display: the value
   comes from the run row, so there are zero extra model calls.
   - Only a settled (`done`) run shows a price; running / failed / cancelled
     runs render "—" so an unfinished run never shows a fake number.
   - `partial` marks a total where some runs had no price: "≥$0.014". */
"use client";

import React from "react";
import { formatUsd } from "./format";

export interface RunCostBadgeProps {
  costUsd: number | null | undefined;
  /** Run lifecycle status; omit for aggregates (the PR list total). */
  status?: string | null;
  /** Some runs in the total have no price → prefix "≥" and show `partialTitle`. */
  partial?: boolean;
  partialTitle?: string;
}

export function RunCostBadge({ costUsd, status, partial = false, partialTitle }: RunCostBadgeProps) {
  const settled = status === undefined || status === "done";
  const text = settled ? formatUsd(costUsd) : "—";
  const known = text !== "—";
  const isPartial = known && partial;
  return (
    <span
      className="mono"
      title={isPartial ? partialTitle : undefined}
      style={{ fontSize: 12, color: known ? "var(--text-secondary)" : "var(--text-muted)" }}
    >
      {isPartial ? `≥${text}` : text}
    </span>
  );
}
