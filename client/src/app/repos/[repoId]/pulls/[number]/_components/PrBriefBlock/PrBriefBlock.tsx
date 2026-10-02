/* PrBriefBlock — one summary, a RISK AREAS list and a REVIEW FOCUS list, read
   from a cached-and-grounded `pr_brief` envelope (spec 0018).

   Reads only `summary`, `risks.risks`, `review_focus`, `missing_inputs` and the
   `stale` flag off the envelope — never `intent`, `blast` or `history` (AC-59):
   those stay the live cards' job (`PrIntentCard`, `BlastRadiusCard`), rendered
   from their own endpoints alongside this block (AC-60), not from here.

   `summary` renders exactly once (AC-28): inside `VerdictBanner` when the pull
   request has a finished review (`finishedReview` non-null, AC-39), or as a
   paragraph in this block otherwise (AC-49) — never both. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, SectionLabel, Skeleton } from "@/components/ui-client";
import { useGenerateBrief, usePrBrief } from "@/lib/hooks/brief";
import type { Verdict } from "@/lib/types";
import { VerdictBanner } from "../VerdictBanner";
import { SEVERITY_STYLE } from "./constants";
import { missingInputLabel } from "./helpers";
import { s } from "./styles";

/** The latest finished review's facts VerdictBanner needs — computed by the
 *  page from `reviews`, never read off the brief envelope. */
export interface FinishedReviewSummary {
  verdict: Verdict;
  score: number | null;
  findingsCount: number;
  blockers: number;
  agentName?: string | null;
}

interface PrBriefBlockProps {
  prId: string | null;
  /** Non-null exactly when the pull request has at least one finished review. */
  finishedReview: FinishedReviewSummary | null;
  /** Activating a review-focus row: lands on Files changed with that file open. */
  onFocusFile: (file: string) => void;
}

export function PrBriefBlock({ prId, finishedReview, onFocusFile }: PrBriefBlockProps) {
  const t = useTranslations("brief");
  const { data, isLoading } = usePrBrief(prId);
  const generate = useGenerateBrief(prId);

  const brief = data?.brief ?? null;
  const stale = data?.stale ?? false;
  // `isLoading` is load-bearing, not cosmetic. While the cached GET is in
  // flight `brief` is null, so without it the control reads "Generate brief"
  // and is enabled on a PR that already HAS one — and a click in that window
  // spends a model call, which AC-19/AC-34 exist to prevent. No component test
  // can catch this: they all stub the hook to resolve synchronously, so the
  // in-flight state never exists in the suite.
  //
  // `isLoading`, not `isFetching`: a background refetch of an already-cached
  // brief must not blank the block.
  const generating = generate.isPending;
  const busy = generating || isLoading;

  const [expanded, setExpanded] = React.useState<ReadonlySet<number>>(new Set());
  const toggleRisk = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <section style={s.box} aria-labelledby="pr-brief-heading">
      <SectionLabel
        icon="FileText"
        right={
          <div style={s.controls}>
            {stale && <span style={s.staleHint}>{t("stale")}</span>}
            <Button
              kind="ghost"
              size="sm"
              icon="RefreshCw"
              loading={busy}
              disabled={busy}
              onClick={() => generate.mutate()}
            >
              {generating
                ? t("busy")
                : isLoading
                  ? t("loading")
                  : brief
                    ? t("refresh")
                    : t("generate")}
            </Button>
          </div>
        }
      >
        <span id="pr-brief-heading">{t("block.title")}</span>
      </SectionLabel>

      {finishedReview && (
        <VerdictBanner
          verdict={finishedReview.verdict}
          summary={brief?.summary ?? null}
          score={finishedReview.score}
          findingsCount={finishedReview.findingsCount}
          blockers={finishedReview.blockers}
          agentName={finishedReview.agentName}
        />
      )}

      {brief && !finishedReview && <p style={s.summary}>{brief.summary}</p>}

      {busy ? (
        <div style={s.skeletons}>
          <Skeleton height={16} style={{ marginBottom: 8 }} />
          <Skeleton height={16} style={{ marginBottom: 8 }} />
          <Skeleton height={16} width="70%" />
        </div>
      ) : brief ? (
        <>
          {brief.missing_inputs.length > 0 && (
            <ul style={s.missingList}>
              {brief.missing_inputs.map((mi) => (
                <li key={mi.input} style={s.missingItem}>
                  {t("unavailable", { label: missingInputLabel(t, mi.input) })}
                  {mi.reason ? ` ${t("unavailableHint", { reason: mi.reason })}` : ""}
                </li>
              ))}
            </ul>
          )}

          <p style={s.sectionHeading}>{t("block.risks")}</p>
          {brief.risks.risks.length === 0 ? (
            <p style={s.noRisks}>{t("noRisks")}</p>
          ) : (
            <ul style={s.riskList}>
              {brief.risks.risks.map((risk, i) => {
                const open = expanded.has(i);
                return (
                  <li key={`${risk.title}-${i}`} style={s.riskRow}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggleRisk(i)}
                      style={s.riskHeader}
                    >
                      <span style={s.riskTitle}>{risk.title}</span>
                      <span style={{ ...s.severityBadge, color: SEVERITY_STYLE[risk.severity].color }}>
                        {t(`severity.${risk.severity}`)}
                      </span>
                      <span style={s.riskToggle}>
                        {t("expandRisk", { open: open ? "true" : "false" })}
                      </span>
                    </button>
                    <div style={s.riskRefs}>
                      {risk.file_refs.map((ref) => (
                        <span key={ref} className="mono" style={s.riskRef}>
                          {ref}
                        </span>
                      ))}
                    </div>
                    {open && <p style={s.riskExplanation}>{risk.explanation}</p>}
                  </li>
                );
              })}
            </ul>
          )}

          {brief.review_focus.length > 0 && (
            <>
              <p style={s.sectionHeading}>{t("block.focus")}</p>
              <ul style={s.focusList}>
                {brief.review_focus.map((item, i) => (
                  <li key={`${item.file}:${item.line}:${i}`} style={s.focusRow}>
                    <button
                      type="button"
                      onClick={() => onFocusFile(item.file)}
                      style={s.focusButton}
                    >
                      <span className="mono" style={s.focusFile}>
                        {item.file}:{item.line}
                      </span>
                      <span style={s.focusReason}>{item.reason}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
