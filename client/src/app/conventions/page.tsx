"use client";

import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { ConventionsView } from "./_components/ConventionsView/ConventionsView";

export default function ConventionsPage() {
  const t = useTranslations("conventions");
  return (
    <AppShell crumb={[{ label: t("crumb.lab") }, { label: t("crumb.conventions") }]}>
      <ConventionsView />
    </AppShell>
  );
}
