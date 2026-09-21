/* SkillsLabShell — the persistent Skills Lab frame (rendered by skills/layout):
   app chrome + the skills list column, with the routed pane on the right. The
   list keeps its scroll and search state while the user moves between skills. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { SkillsListColumn } from "../SkillsListColumn/SkillsListColumn";
import { s } from "./styles";

export function SkillsLabShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("skills");
  const params = useParams<{ id?: string }>();
  return (
    <AppShell crumb={[{ label: t("crumb.lab") }, { label: t("crumb.skills"), href: "/skills" }]}>
      <div style={s.row}>
        <SkillsListColumn selectedId={params.id} />
        <div style={s.pane}>{children}</div>
      </div>
    </AppShell>
  );
}
