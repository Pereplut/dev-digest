"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@/components/ui-client";
import { PrBriefBlock, type FinishedReviewSummary } from "../PrBriefBlock";
import { PrIntentCard } from "../PrIntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  /** Null while the PR row is still resolving; the cards render nothing then. */
  prId: string | null;
  /** Null until the repo loads; a caller row then renders as text, not a broken link. */
  repoFullName: string | null | undefined;
  headSha: string | null | undefined;
  /** Non-null exactly when the pull request has at least one finished review. */
  finishedReview: FinishedReviewSummary | null;
  /** Activating a Review focus row: lands on Files changed with that file open. */
  onFocusFile: (file: string) => void;
}

export function OverviewTab({
  prBody,
  prId,
  repoFullName,
  headSha,
  finishedReview,
  onFocusFile,
}: OverviewTabProps) {
  const t = useTranslations("prReview");
  return (
    <>
      {/* Above the description, and above the intent card: the brief reads
          first (spec 0018). It renders none of the live cards' own data. */}
      <PrBriefBlock prId={prId} finishedReview={finishedReview} onFocusFile={onFocusFile} />
      <PrIntentCard prId={prId} />
      <BlastRadiusCard prId={prId} repoFullName={repoFullName} headSha={headSha} />
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("overview.description")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
