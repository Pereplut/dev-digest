/* Landing for /multi-agent-review. `?new=1` forces Configure run; otherwise the
   workspace's newest run is opened, and Configure run shows when there is none.
   `data` is undefined while loading — "unknown", not "none" — so a status
   placeholder renders until the query settles instead of flashing Configure run. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { useLatestMultiAgentRun } from "@/lib/hooks/multiAgentReview";
import { ConfigureRun } from "../ConfigureRun";
import { landingTarget } from "./helpers";

export function MultiAgentLanding() {
  const t = useTranslations("multiAgentReview");
  const router = useRouter();
  const search = useSearchParams();
  const isNew = search.get("new") === "1";
  const { data, isLoading } = useLatestMultiAgentRun();
  const targetId = landingTarget(isNew, data);

  React.useEffect(() => {
    if (targetId) router.replace(`/multi-agent-review/${targetId}`);
  }, [targetId, router]);

  const waiting = !isNew && (isLoading || targetId !== null);

  return (
    <AppShell crumb={[{ label: t("configure.crumbRoot") }, { label: t("configure.crumb") }]}>
      {waiting ? (
        <div role="status" aria-label={t("landing.loading")} style={{ padding: "28px 32px" }} />
      ) : (
        <ConfigureRun initialPrId={search.get("pr")} />
      )}
    </AppShell>
  );
}
