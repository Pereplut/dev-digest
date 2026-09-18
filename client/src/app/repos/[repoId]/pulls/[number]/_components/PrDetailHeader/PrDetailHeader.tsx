"use client";

import React, { useCallback } from "react";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, Button, Tabs } from "@/components/ui-client";
import { RunReviewDropdown } from "../RunReviewDropdown";
import { s } from "./styles";
import type { PrDetail } from "@/lib/types";

interface PrDetailHeaderProps {
  pr: PrDetail;
  prId: string | null;
  tab: string;
  findingsCount: number;
  /** github.com PR URL; null when the repo's full_name isn't known yet. */
  githubUrl?: string | null;
  onSetTab: (tab: string) => void;
  onRunStart: () => void;
  onRunsStarted: () => void;
}

export function PrDetailHeader({
  pr,
  prId,
  tab,
  findingsCount,
  githubUrl,
  onSetTab,
  onRunStart,
  onRunsStarted,
}: PrDetailHeaderProps) {
  const t = useTranslations("prReview");

  const handleRunStart = useCallback(() => {
    onRunStart();
  }, [onRunStart]);

  const handleRunsStarted = useCallback(() => {
    onRunsStarted();
  }, [onRunsStarted]);

  const statusColor =
    pr.status === "merged"
      ? "var(--ok)"
      : pr.status === "closed"
        ? "var(--stale)"
        : "var(--warn)";

  return (
    <div style={s.root}>
      <div style={s.titleRow}>
        <div style={s.titleCol}>
          <h1 style={s.h1}>
            <span className="mono" style={s.prNumber}>
              #{pr.number}
            </span>
            {pr.title}
          </h1>
          <div style={s.meta}>
            <span style={s.authorChip}>
              <Avatar name={pr.author} size={17} />
              {pr.author}
            </span>
            <span style={s.branchChip}>
              <Icon.GitBranch size={13} style={{ color: "var(--text-muted)" }} />
              <span className="mono" style={s.branchMono}>
                {pr.branch}
              </span>
              <Icon.ArrowRight size={11} />
              <span className="mono" style={s.branchMono}>
                {pr.base}
              </span>
            </span>
            <span className="mono tnum">
              <span style={{ color: "var(--code-add-text)" }}>+{pr.additions}</span>{" "}
              <span style={{ color: "var(--code-del-text)" }}>−{pr.deletions}</span>
            </span>
            {/* PrStatus has six members; header.status covers all six, in the
                lowercase this badge has always rendered (list.status.* is the
                Title Case variant used by the PR table). */}
            <Badge dot bg="transparent" color={statusColor}>
              {t(`header.status.${pr.status}`)}
            </Badge>
          </div>
        </div>
        <div style={s.actions}>
          <Button
            kind="ghost"
            size="sm"
            icon="ExternalLink"
            disabled={!githubUrl}
            onClick={() =>
              githubUrl && window.open(githubUrl, "_blank", "noopener,noreferrer")
            }
          >
            {t("header.viewOnGitHub")}
          </Button>
          {prId && (
            <RunReviewDropdown
              prId={prId}
              warnMerged={pr.status === "merged" || pr.status === "closed"}
              onRunStart={handleRunStart}
              onRunsStarted={handleRunsStarted}
            />
          )}
        </div>
      </div>
      {(pr.status === "merged" || pr.status === "closed") && (
        <div style={s.staleBanner}>
          <Icon.AlertTriangle size={13} style={{ color: "var(--warn)", flexShrink: 0 }} />
          {/* Two whole sentences rather than one with a {status} slot: the
              status word is not a drop-in noun in every language. */}
          <span>
            {pr.status === "merged"
              ? t("header.staleBannerMerged")
              : t("header.staleBannerClosed")}
          </span>
        </div>
      )}
      {/* These three labels are the accessible names e2e flows 04 and 05 click
          by ("Agent runs", "Files changed") — the JSON copy is byte-identical. */}
      <Tabs
        value={tab}
        onChange={onSetTab}
        pad="0"
        tabs={[
          { key: "overview", label: t("header.tabs.overview"), icon: "FileText" },
          {
            key: "findings",
            label: t("header.tabs.findings"),
            icon: "AlertOctagon",
            count: findingsCount || undefined,
          },
          { key: "diff", label: t("header.tabs.diff"), icon: "Code", count: pr.files_count },
        ]}
      />
    </div>
  );
}
