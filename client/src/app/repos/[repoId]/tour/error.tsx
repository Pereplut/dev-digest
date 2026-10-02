/* Error boundary for the onboarding tour segment (spec 0017, P2 — adopted by
   the user). Mirrors `../pulls/error.tsx`: scoped here so a failure loading
   or rendering the tour keeps the app chrome instead of blanking the whole
   page. No criterion covers this; it is a sibling-route convention this page
   should not silently lack.

   `reset()` is the Next 15 API (v16 renamed it `retry()`). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState } from "@/components/ui-client";
import { AppShell } from "@/components/app-shell";

export default function TourError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("onboarding");

  React.useEffect(() => {
    console.error("Error in the onboarding tour segment:", error);
  }, [error]);

  return (
    <AppShell crumb={[{ label: t("tour.breadcrumb") }]}>
      <ErrorState title={t("tour.error.title")} body={t("tour.error.body")} onRetry={reset} />
    </AppShell>
  );
}
