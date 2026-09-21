/* Route: /skills/:id — the selected skill's detail pane (the list column comes
   from skills/layout). Tab state lives in ?tab= (config|preview|stats|versions). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@/components/ui-client";
import { useSkill } from "@/lib/hooks/skills";
import { ApiError } from "@/lib/api";
import { SkillDetail } from "../_components/SkillDetail/SkillDetail";
import { parseTab } from "../_components/SkillDetail/helpers";
import type { SkillTab } from "../_components/SkillDetail/constants";

export default function SkillPage() {
  const t = useTranslations("skills");
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);

  const tab = parseTab(search.get("tab"));
  const setTab = (next: SkillTab) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  if (isError || (!isLoading && !skill)) {
    return (
      <ErrorState
        title={t("detail.loadErrorTitle")}
        body={error instanceof ApiError ? error.message : t("detail.loadErrorBody")}
        onRetry={() => refetch()}
      />
    );
  }
  if (isLoading || !skill) {
    return (
      <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
        <Skeleton height={24} width={240} />
        <Skeleton height={200} />
      </div>
    );
  }
  return <SkillDetail skill={skill} tab={tab} onTab={setTab} />;
}
