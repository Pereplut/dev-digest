/* ConventionsView — the Conventions page body.

   Extraction runs in the background, so while a scan is `running` the query
   polls and the Re-scan button shows its progress. The accepted set is what the
   "Create skill" modal merges. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { ConventionCandidate, SkillType } from "@devdigest/shared";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@/components/ui-client";
import { useActiveRepo } from "@/lib/repo-context";
import { useToast } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import {
  useBulkPatchConventions,
  useConventionSkillDefaults,
  useConventions,
  useCreateConventionSkill,
  useExtractConventions,
  usePatchConvention,
} from "@/lib/hooks/conventions";
import { ConventionCard } from "../ConventionCard/ConventionCard";
import { CreateSkillModal } from "../CreateSkillModal/CreateSkillModal";
import { acceptedIds, countAccepted, isRunning, partition, relativeTime } from "./helpers";
import { s } from "./styles";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const router = useRouter();
  const toast = useToast();
  const { repoId, activeRepo } = useActiveRepo();

  const [modalOpen, setModalOpen] = React.useState(false);
  const [showRejected, setShowRejected] = React.useState(false);

  const [polling, setPolling] = React.useState(false);
  const conventions = useConventions(repoId, polling);
  const scan = conventions.data?.scan ?? null;
  const running = isRunning(scan);

  // Poll only while a scan is in flight, then stop.
  React.useEffect(() => {
    setPolling(running);
  }, [running]);

  const extract = useExtractConventions(repoId);
  const patch = usePatchConvention(repoId);
  const deselect = useBulkPatchConventions(repoId);
  const defaults = useConventionSkillDefaults(repoId, modalOpen);
  const createSkill = useCreateConventionSkill(repoId);

  // The defaults request is only enabled once the modal opens, and a 4xx is
  // silent by design (lib/providers.tsx toasts 0 and 5xx only). Without this
  // the modal would stay "open" with nothing rendered and the button would
  // look permanently dead, because re-clicking sets the same state.
  //
  // `isFetching` is part of the condition, not decoration: TanStack keeps
  // status 'error' while the re-enabled query retries, so on the NEXT click
  // this effect would see the PREVIOUS failure on the first render and close
  // the modal again before the refetch could settle — one extra dead click
  // after every failure.
  const defaultsFailed = modalOpen && defaults.isError && !defaults.isFetching;
  React.useEffect(() => {
    if (!defaultsFailed) return;
    setModalOpen(false);
    toast.error(t("create.loadError"));
  }, [defaultsFailed, toast, t]);

  const candidates = conventions.data?.candidates ?? [];
  const { visible, rejected } = partition(candidates);
  const accepted = countAccepted(candidates);
  const repoName = activeRepo?.full_name.split("/").pop() ?? "";

  const setStatus = (c: ConventionCandidate, status: "accepted" | "rejected" | "pending") =>
    patch.mutate({ id: c.id, patch: { status } });

  const onSubmitSkill = (draft: {
    name: string;
    description: string;
    type: SkillType;
    body: string;
    enabled: boolean;
  }) => {
    createSkill.mutate(
      { ...draft, candidate_ids: acceptedIds(candidates) },
      {
        onSuccess: (skill) => {
          setModalOpen(false);
          toast.success(t("create.successToast", { name: skill.name }));
          router.push(`/skills/${skill.id}`);
        },
      },
    );
  };

  if (!repoId) {
    return (
      <div style={s.page}>
        <EmptyState icon="GitBranch" title={t("list.noRepoTitle")} body={t("list.noRepoBody")} />
      </div>
    );
  }

  if (conventions.isLoading) {
    return (
      <div style={s.page}>
        <Skeleton height={64} />
        <Skeleton height={180} />
        <Skeleton height={180} />
      </div>
    );
  }

  if (conventions.isError) {
    return (
      <div style={s.page}>
        <ErrorState body={t("list.loadError")} onRetry={() => void conventions.refetch()} />
      </div>
    );
  }

  const sampleCount = scan?.sample_file_count ?? 0;
  const when = relativeTime(scan?.finished_at ?? scan?.started_at);

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>
            {t("list.title")} <span className="mono" style={s.repoName}>{repoName}</span>
          </h1>
          <p style={s.subtitle}>
            {running
              ? t("list.scanning")
              : scan
                ? `${t("list.detected", { count: sampleCount })} · ${
                    when ? t("list.lastScan", { when }) : t("list.neverScanned")
                  }`
                : t("list.neverScanned")}
          </p>
        </div>
        <Button
          kind="secondary"
          icon="RefreshCw"
          loading={running || extract.isPending}
          onClick={() => extract.mutate()}
        >
          {t("list.rescan")}
        </Button>
      </div>

      {scan?.status === "failed" ? (
        <p style={s.failed}>{t("list.scanFailed", { reason: scan.error ?? "unknown" })}</p>
      ) : null}

      {extract.error instanceof ApiError && extract.error.status === 409 ? (
        <p style={s.notice}>{t("list.noCloneBody")}</p>
      ) : null}

      {scan?.sampler === "walk" ? <p style={s.notice}>{t("list.sampledByWalk")}</p> : null}

      {candidates.length === 0 ? (
        <EmptyState
          icon="ListChecks"
          title={t("list.emptyTitle")}
          body={t("list.emptyBody")}
          cta={t("list.emptyCta")}
          onCta={() => extract.mutate()}
          ctaLoading={extract.isPending || running}
        />
      ) : (
        <>
          <div style={s.toolbar}>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              // Only the accepted ones need a write; patching the rest would be
              // a no-op request per card. One bulk mutation, not one per card,
              // so a partial failure can't roll the others back with it.
              onClick={() =>
                deselect.mutate({
                  ids: visible.filter((c) => c.status === "accepted").map((c) => c.id),
                  patch: { status: "pending" },
                })
              }
              disabled={accepted === 0 || deselect.isPending}
            >
              {t("list.deselectAll")}
            </Button>
            <span style={s.counter}>
              {t("list.counter", { accepted, total: visible.length })}
            </span>
            <span style={s.spacer} />
            <Button
              kind="primary"
              icon="Sparkles"
              disabled={accepted === 0}
              loading={modalOpen && defaults.isLoading}
              onClick={() => setModalOpen(true)}
            >
              {t("list.createSkill")}
            </Button>
          </div>

          <div style={s.list}>
            {visible.map((c) => (
              <ConventionCard
                key={c.id}
                candidate={c}
                onAccept={() => setStatus(c, c.status === "accepted" ? "pending" : "accepted")}
                onReject={() => setStatus(c, "rejected")}
                onEditRule={(rule) => patch.mutate({ id: c.id, patch: { rule } })}
              />
            ))}
          </div>

          {rejected.length > 0 ? (
            <>
              <div style={s.rejectedHeading}>
                <Badge color="var(--text-muted)" bg="var(--bg-hover)">
                  {t("list.rejectedCount", { count: rejected.length })}
                </Badge>
                <Button kind="ghost" size="sm" onClick={() => setShowRejected(!showRejected)}>
                  {showRejected ? t("list.hideRejected") : t("list.showRejected")}
                </Button>
              </div>
              {showRejected ? (
                <div style={s.list}>
                  {rejected.map((c) => (
                    <ConventionCard
                      key={c.id}
                      candidate={c}
                      onAccept={() => setStatus(c, "accepted")}
                      onReject={() => setStatus(c, "pending")}
                      onEditRule={(rule) => patch.mutate({ id: c.id, patch: { rule } })}
                    />
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </>
      )}

      {modalOpen && defaults.data ? (
        <CreateSkillModal
          repoName={repoName}
          acceptedCount={accepted}
          defaults={defaults.data}
          saving={createSkill.isPending}
          serverError={createSkill.error instanceof ApiError ? createSkill.error.message : null}
          onCancel={() => setModalOpen(false)}
          onSubmit={onSubmitSkill}
        />
      ) : null}
    </div>
  );
}
