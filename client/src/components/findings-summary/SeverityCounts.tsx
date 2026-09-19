/* SeverityCounts — compact per-severity finding chips (icon + count, zeros
   hidden), or "—" when there is nothing open to show. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SeverityBadge } from "@/components/ui-client";
import type { FindingsCounts } from "@devdigest/shared";
import { FINDING_SEVERITIES, totalFindings } from "./helpers";
import { s } from "./styles";

/** Accessible summary of non-zero counts, e.g. "1 critical, 2 warnings". */
export function useSeverityCountsLabel(counts: FindingsCounts | null | undefined): string {
  const t = useTranslations("prReview.findingsSummary");
  if (!counts) return "";
  return FINDING_SEVERITIES.filter((sev) => counts[sev] > 0)
    .map((sev) => t(`count.${sev}`, { count: counts[sev] }))
    .join(", ");
}

export function SeverityCounts({ counts }: { counts: FindingsCounts | null | undefined }) {
  if (!counts || totalFindings(counts) === 0) return <span style={s.muted}>—</span>;
  return (
    <span style={s.counts}>
      {FINDING_SEVERITIES.map((sev) =>
        counts[sev] > 0 ? <SeverityBadge key={sev} severity={sev} count={counts[sev]} compact /> : null,
      )}
    </span>
  );
}
