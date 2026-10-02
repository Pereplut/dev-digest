"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@/components/ui-client";
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
}

export function OverviewTab({ prBody, prId, repoFullName, headSha }: OverviewTabProps) {
  const t = useTranslations("prReview");
  return (
    <>
      {/* Above the description: the intent summarises it, so it reads first. */}
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
