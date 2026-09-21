/* SkillsIndex — the /skills pane: opens the first skill when there is one,
   otherwise invites the user to create or import their first skill. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Skeleton } from "@/components/ui-client";
import { useSkills } from "@/lib/hooks/skills";
import { ImportSkillModal } from "../ImportSkillModal/ImportSkillModal";
import { s } from "./styles";

export function SkillsIndex() {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError } = useSkills();
  const [importing, setImporting] = React.useState(false);
  const firstId = skills?.[0]?.id;

  // Syncs the URL (an external system) with the list: /skills is only a
  // landing route, so it is replaced rather than pushed.
  React.useEffect(() => {
    if (firstId) router.replace(`/skills/${firstId}`);
  }, [firstId, router]);

  // The list column shows the load error; this pane has nothing to add.
  if (isError) return null;
  if (isLoading || firstId) {
    return (
      <div style={s.pad}>
        <Skeleton height={24} width={240} />
        <Skeleton height={200} />
      </div>
    );
  }

  return (
    <div style={s.empty}>
      {importing && <ImportSkillModal onClose={() => setImporting(false)} />}
      <div>
        <EmptyState icon="Sparkles" title={t("index.emptyTitle")} body={t("index.emptyBody")} />
        <div style={s.actions}>
          <Button kind="primary" icon="Plus" onClick={() => router.push("/skills/new")}>
            {t("index.create")}
          </Button>
          <Button kind="secondary" icon="Upload" onClick={() => setImporting(true)}>
            {t("index.import")}
          </Button>
        </div>
      </div>
    </div>
  );
}
