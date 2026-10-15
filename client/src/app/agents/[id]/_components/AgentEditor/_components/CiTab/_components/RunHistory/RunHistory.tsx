"use client";

import { useTranslations } from "next-intl";
import { CiVerdictBadge } from "@/components/ci-verdict-badge";
import { RunCostBadge } from "@/components/run-cost-badge";
import type { CiRun } from "@devdigest/shared";
import { NO_VALUE } from "../../constants";
import { formatTimestamp, prLabel } from "../../helpers";
import { s } from "../../styles";

const COLUMNS = ["ranAt", "repository", "pullRequest", "verdict", "findings", "cost"] as const;

/** Run history from `GET /ci/runs?agent_id=` (AC-59). */
export function RunHistory({ runs }: { runs: CiRun[] }) {
  const t = useTranslations("ci");
  if (runs.length === 0) {
    return <p style={s.meta}>{t("ciTab.noRuns")}</p>;
  }
  return (
    <table style={s.table}>
      <caption style={s.srOnly}>{t("ciTab.runHistory")}</caption>
      <thead>
        <tr>
          {COLUMNS.map((col) => (
            <th key={col} scope="col" style={s.th}>
              {t(`ciTab.historyColumns.${col}`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id}>
            <td style={s.td}>{formatTimestamp(run.ran_at)}</td>
            <td style={s.td}>{run.repo}</td>
            <td style={s.td}>{prLabel(run.pr_number)}</td>
            <td style={s.td}>
              <CiVerdictBadge run={run} />
            </td>
            <td style={s.td}>{run.findings_count ?? NO_VALUE}</td>
            <td style={s.td}>
              <RunCostBadge costUsd={run.cost_usd} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
