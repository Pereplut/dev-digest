/* CiRunsView — the /ci table (spec 0022 AC-72..75). Rows are `source='ci'`
   agent runs ingested from Actions artifacts. Refresh posts once and refetches;
   a degraded result shows a banner and keeps the rows already on screen. */
"use client";

import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, MonoLink, Skeleton } from "@/components/ui-client";
import { CiVerdictBadge } from "@/components/ci-verdict-badge";
import { RunCostBadge } from "@/components/run-cost-badge";
import { useCiRuns, useRefreshCi } from "@/lib/hooks/ci";
import { NO_VALUE, formatDuration, formatPr, formatTimestamp } from "./helpers";
import { s } from "./styles";

const COLUMNS = ["repository", "pullRequest", "agent", "verdict", "findings", "cost", "duration", "job"] as const;

export function CiRunsView() {
  const t = useTranslations("ci");
  const runs = useCiRuns();
  const refresh = useRefreshCi();
  const degraded = refresh.data?.degraded === true;
  const rows = runs.data ?? [];

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>{t("runs.title")}</h1>
          <p style={s.subtitle}>{t("runs.subtitle")}</p>
        </div>
        <Button
          kind="secondary"
          size="sm"
          icon="RefreshCw"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          {refresh.isPending ? t("runs.refreshing") : t("runs.refresh")}
        </Button>
      </div>

      {degraded && (
        <div role="status" style={s.banner}>
          <Icon.AlertTriangle size={14} />
          {refresh.data?.message || t("runs.degradedFallback")}
        </div>
      )}

      {refresh.isError && (
        <div role="alert" style={s.banner}>
          <Icon.AlertTriangle size={14} />
          {t("runs.refreshFailed", { error: refresh.error.message })}
        </div>
      )}

      {runs.isLoading && (
        <div style={s.skeletons}>
          <Skeleton height={36} />
          <Skeleton height={36} />
          <Skeleton height={36} />
        </div>
      )}

      {runs.isError && <ErrorState body={t("runs.loadError")} onRetry={() => runs.refetch()} />}

      {runs.isSuccess && rows.length === 0 && (
        <EmptyState icon="Workflow" title={t("runs.emptyTitle")} body={t("runs.emptyBody")} />
      )}

      {runs.isSuccess && rows.length > 0 && (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <caption style={s.srOnly}>{t("runs.title")}</caption>
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col} scope="col" style={s.th}>
                    {t(`runs.table.${col}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((run) => (
                <tr key={run.id} title={formatTimestamp(run.ran_at)}>
                  <td style={s.td}>{run.repo}</td>
                  <td style={s.td}>{formatPr(run.pr_number)}</td>
                  <td style={s.td}>{run.agent_name ?? NO_VALUE}</td>
                  <td style={s.td}>
                    <CiVerdictBadge run={run} />
                  </td>
                  <td style={s.td}>{run.findings_count ?? NO_VALUE}</td>
                  <td style={s.td}>
                    <RunCostBadge costUsd={run.cost_usd} />
                  </td>
                  <td style={s.td}>{formatDuration(run.duration_ms)}</td>
                  <td style={s.td}>
                    <MonoLink href={run.job_url}>{t("runs.viewJob")}</MonoLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
