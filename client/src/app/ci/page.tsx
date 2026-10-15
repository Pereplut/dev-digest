"use client";

import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { CiRunsView } from "./_components/CiRunsView/CiRunsView";

/** Route: /ci — workspace-wide CI runs (spec 0022). */
export default function CiRunsPage() {
  const t = useTranslations("ci");
  return (
    <AppShell crumb={[{ label: t("page.crumb") }]}>
      <CiRunsView />
    </AppShell>
  );
}
