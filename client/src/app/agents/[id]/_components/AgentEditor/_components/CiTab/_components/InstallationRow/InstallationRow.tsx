"use client";

import { useTranslations } from "next-intl";
import { Badge, MonoLink } from "@/components/ui-client";
import { CiVerdictBadge } from "@/components/ci-verdict-badge";
import type { CiInstallation } from "@devdigest/shared";
import { NO_VALUE, STATUS_COLOR } from "../../constants";
import { formatDate, formatTimestamp } from "../../helpers";
import { s } from "../../styles";

/** One installation: repo, target, status, workflow version and last run (AC-56). */
export function InstallationRow({ installation }: { installation: CiInstallation }) {
  const t = useTranslations("ci");
  const { last_run: lastRun } = installation;
  return (
    <div style={s.card}>
      <div style={s.cardRow}>
        <span style={s.repo}>{installation.repo}</span>
        <Badge color="var(--text-secondary)" mono>
          {installation.target_type === "gha" ? t("exportWizard.targets.gha") : installation.target_type}
        </Badge>
        <Badge color={STATUS_COLOR[installation.status]}>{t(`ciTab.status.${installation.status}`)}</Badge>
        <span style={s.meta}>
          {t("ciTab.version", { version: installation.workflow_version })} ·{" "}
          {t("ciTab.installed", { date: formatDate(installation.installed_at) })}
        </span>
        {installation.pr_url && <MonoLink href={installation.pr_url}>{t("ciTab.viewPr")}</MonoLink>}
      </div>
      <div style={{ ...s.cardRow, marginTop: 10 }}>
        <span style={s.meta}>{t("ciTab.lastRun")}:</span>
        {lastRun ? (
          <>
            <CiVerdictBadge run={lastRun} />
            <span style={s.meta}>{formatTimestamp(lastRun.ran_at)}</span>
          </>
        ) : (
          <span style={s.meta}>{NO_VALUE}</span>
        )}
      </div>
    </div>
  );
}
