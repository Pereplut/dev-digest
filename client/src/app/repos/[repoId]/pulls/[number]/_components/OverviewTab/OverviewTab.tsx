"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@/components/ui-client";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
}

export function OverviewTab({ prBody }: OverviewTabProps) {
  const t = useTranslations("prReview");
  return (
    <>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("overview.description")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
