/* FindingsPanel — severity pills (counts + click-to-filter), hide-low-confidence,
   j/k navigation + FindingCard list, wiring the accept/reject action hook (A2).
   Pill counts are a plain group-by over the findings already loaded for this
   run (the same list the cards render) — no fetch, no LLM call. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState, SeverityBadge, type Severity } from "@/components/ui-client";
import type { FindingRecord } from "@devdigest/shared";
import {
  FINDING_SEVERITIES,
  countBySeverity,
  type FindingSeverity,
} from "@/components/findings-summary";
import { FindingCard } from "../FindingCard";
// Was `../FindingCard/constants` — reaching past FindingCard's barrel into its
// internals. The colours now live in the shared findings-summary module.
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "@/components/findings-summary";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { KEY_TO_ACTION } from "./constants";
import { filterBySeverity, visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  const [sevFilter, setSevFilter] = React.useState<FindingSeverity | null>(null);
  const [focusIdx, setFocusIdx] = React.useState(0);

  // The cards' list before the severity filter — the pills count exactly this.
  const base = React.useMemo(() => visibleFindings(findings, hideLow), [findings, hideLow]);
  const counts = React.useMemo(() => countBySeverity(base), [base]);
  // A filter whose severity no longer has cards (e.g. hidden as low confidence) clears itself.
  const active = sevFilter && counts[sevFilter] > 0 ? sevFilter : null;
  const shown = React.useMemo(() => filterBySeverity(base, active), [base, active]);
  const present = FINDING_SEVERITIES.filter((sev) => counts[sev] > 0);

  React.useEffect(() => setFocusIdx(0), [active, hideLow]);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        {present.length > 0 && (
          <div role="group" aria-label={t("panel.severityFilter")} style={s.pills}>
            {present.map((sev, i) => {
              const label = t(`panel.severityPill.${sev}`, { count: counts[sev] });
              const on = active === sev;
              return (
                <React.Fragment key={sev}>
                  {i > 0 && (
                    <span aria-hidden="true" style={s.pillSep}>
                      ·
                    </span>
                  )}
                  <button
                    type="button"
                    aria-pressed={on}
                    aria-label={label}
                    onClick={() => setSevFilter(on ? null : sev)}
                    style={s.pill(on, SEV_COLOR[sev] ?? SEV_COLOR_FALLBACK)}
                  >
                    <SeverityBadge severity={sev as Severity} compact />
                    <span>{label}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        )}
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
            />
          ))
        )}
      </div>
    </div>
  );
}
