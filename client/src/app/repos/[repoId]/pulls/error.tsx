/* Error boundary for the PR list segment.

   Scoped here so a failure loading or rendering the PR list keeps the app
   chrome (nav, breadcrumbs, shortcuts) instead of blanking the whole page —
   the user can still navigate to Agents or Settings. The page renders its own
   <AppShell> and this boundary replaces the page, so the fallback renders the
   shell itself. If the shell is what threw, the error bubbles to app/error.tsx.

   `reset()` is the Next 15 API (v16 renamed it `retry()`). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState } from "@/components/ui-client";
import { AppShell } from "@/components/app-shell";

export default function PullsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  const tPr = useTranslations("prReview");

  React.useEffect(() => {
    console.error("Error in the PR list segment:", error);
  }, [error]);

  return (
    <AppShell crumb={[{ label: tPr("list.breadcrumb") }]}>
      <ErrorState
        title={t("boundary.pullsTitle")}
        body={t("boundary.pullsBody")}
        onRetry={reset}
      />
    </AppShell>
  );
}
