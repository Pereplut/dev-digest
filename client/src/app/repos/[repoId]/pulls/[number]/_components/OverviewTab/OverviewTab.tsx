"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@/components/ui-client";
import { PrIntentCard } from "../PrIntentCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  /** Null while the PR row is still resolving; the card renders nothing then. */
  prId: string | null;
}

export function OverviewTab({ prBody, prId }: OverviewTabProps) {
  const t = useTranslations("prReview");
  return (
    <>
      {/* Above the description: the intent summarises it, so it reads first. */}
      <PrIntentCard prId={prId} />
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("overview.description")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
