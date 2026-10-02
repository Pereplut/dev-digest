/* OnboardingTour — the repository tour page body (spec 0017): header, a
   role="status" banner, the TOC and the five collapsible sections. Rendered
   inside the page's own <AppShell>, not its own — this component owns only
   the tour content. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Skeleton } from "@/components/ui-client";
import { ApiError } from "@/lib/api";
import { useOnboardingTour, useRegenerateOnboarding, useResyncRepoIntel } from "@/lib/hooks";
import type { OnboardingSectionKind, OnboardingTour as OnboardingTourData } from "@/lib/types";
import { TourToc } from "../TourToc";
import { TourSection } from "../TourSection";
import { SECTION_KINDS } from "./constants";
import { computeAge, droppedTotal, isBlockingReason, isReindexableReason, repoShortName, showsStatus } from "./helpers";
import { s } from "./styles";

type T = (key: string, values?: Record<string, string | number | Date>) => string;

function ageText(t: T, iso: string): string {
  const { unit, count } = computeAge(iso);
  return t(`tour.age.${unit}`, { count });
}

/** The role="status" sentence: reason takes precedence over the bare status
    text (AC-50), with the still-running / generation-failed / dropped-refs
    clauses appended as their own sentences (AC-54, AC-60, AC-87). */
function buildStatusText(t: T, data: OnboardingTourData, dropped: number, gaveUp: boolean): string {
  if (data.status === "done") {
    return dropped > 0 ? t("tour.droppedRefs", { count: dropped }) : "";
  }
  if (data.status === "running" && gaveUp) return t("tour.stillRunning");

  let text = data.reason ? t(`tour.reason.${data.reason}`) : t(`tour.status.${data.status}`);
  if (data.reason === "generation_failed" && data.generated_at) {
    text += " " + t("tour.failedShowingAge", { age: ageText(t, data.generated_at) });
  }
  if (dropped > 0) text += " " + t("tour.droppedRefs", { count: dropped });
  return text;
}

export function OnboardingTour({ repoId, repoFullName }: { repoId: string; repoFullName: string }) {
  const t = useTranslations("onboarding") as unknown as T;
  const tour = useOnboardingTour(repoId);
  const regenerate = useRegenerateOnboarding(repoId);
  const resync = useResyncRepoIntel(repoId);

  const [openKinds, setOpenKinds] = React.useState<Record<OnboardingSectionKind, boolean>>(() =>
    Object.fromEntries(SECTION_KINDS.map((k) => [k, true])) as Record<OnboardingSectionKind, boolean>,
  );

  const toggle = (kind: OnboardingSectionKind) => setOpenKinds((p) => ({ ...p, [kind]: !p[kind] }));
  const expand = (kind: OnboardingSectionKind) => setOpenKinds((p) => ({ ...p, [kind]: true }));

  const onRegenerate = () => {
    // AC-73: no confirmation dialog — fire the POST straight from the click.
    regenerate.mutate(undefined, { onSuccess: () => tour.resetPolling() });
  };

  // AC-74: a loading skeleton and no section body while the first GET is in
  // flight. `isLoading`, never `isFetching` — a background poll must not
  // flash the skeleton back over sections already on screen.
  if (tour.isLoading) {
    return (
      <div style={s.loadingStack} role="status" aria-label={t("tour.loading")}>
        {SECTION_KINDS.map((k) => (
          <Skeleton key={k} height={64} />
        ))}
      </div>
    );
  }

  const data = tour.data;
  if (tour.isError || !data) {
    return (
      <ErrorState
        title={t("tour.error.title")}
        body={tour.error instanceof ApiError ? tour.error.message : t("tour.error.body")}
        onRetry={() => tour.refetch()}
      />
    );
  }

  const dropped = droppedTotal(data.sections);
  const blocked = isBlockingReason(data.reason);
  const regenerateDisabled = (data.status === "running" && !tour.gaveUp) || blocked || regenerate.isPending;
  const showReindex = isReindexableReason(data.reason);
  const showStatusBar = showsStatus(data.status, dropped);
  const statusText = buildStatusText(t, data, dropped, tour.gaveUp);
  const tone = data.status === "failed" || data.status === "not_generated" ? "crit" : data.status === "running" ? "muted" : "warn";

  return (
    <>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>{repoShortName(repoFullName)}</h1>
          <p style={s.pageSubtitle}>
            {data.files_indexed != null
              ? t("tour.subline.withCount", { count: data.files_indexed })
              : t("tour.subline.noIndex")}
            {data.generated_at && <> · {t("tour.lastRefreshed", { age: ageText(t, data.generated_at) })}</>}
          </p>
        </div>
        <div style={s.headerActions}>
          {showReindex && (
            <Button kind="secondary" onClick={() => resync.mutate()} disabled={resync.isPending}>
              {t("tour.reindex")}
            </Button>
          )}
          <Button
            kind="primary"
            icon="RefreshCw"
            loading={regenerate.isPending}
            disabled={regenerateDisabled}
            onClick={onRegenerate}
          >
            {regenerate.isPending ? t("tour.regenerating") : t("tour.regenerate")}
          </Button>
        </div>
      </div>

      {showStatusBar && (
        <div role="status" aria-label={statusText} style={s.statusBar(tone)}>
          {statusText}
        </div>
      )}

      <div style={s.layout}>
        <TourToc onNavigate={expand} />
        <div style={s.main}>
          {data.sections.map((section) => (
            <TourSection
              key={section.kind}
              section={section}
              open={!!openKinds[section.kind]}
              onToggle={() => toggle(section.kind)}
            />
          ))}
        </div>
      </div>
    </>
  );
}
