/* RecentRunsTable — up to 10 of the agent's most recent batches, any status
   (AC-46). A `done` row carries a selection checkbox (AC-47) so two of them
   can be diffed in the compare modal; every row carries, in its OWN trailing
   cell, a plain `<button>` that opens that batch's case detail (AC-73) — the
   `<tr>` itself is not a click target and carries no `role="button"`, and
   status is a `Badge` (a `<span>`), never a `Chip` (always a `<button>`),
   so neither control's accessible name concatenates the other's text
   (client/INSIGHTS.md:126-132, :175-179). A native `<input type="checkbox">`
   is used instead of the vendored kit `Checkbox` — that component takes no
   `disabled` prop at all (`client/src/vendor/ui/kit/Checkbox.tsx`), and
   AC-49 requires every unselected checkbox to actually become disabled at
   two selections. */
"use client";

import { useTranslations } from "next-intl";
import type { EvalBatchRecord } from "@devdigest/shared";
import { Badge, Button } from "@/components/ui-client";
import { formatCostTile, formatRatioTile, passedLabel } from "../../helpers";
import { s, statusBadgeColors } from "./styles";

export function RecentRunsTable({
  batches,
  selected,
  onToggleSelect,
  onOpenDetail,
}: {
  batches: readonly EvalBatchRecord[];
  selected: readonly string[];
  onToggleSelect: (batchId: string, checked: boolean) => void;
  onOpenDetail: (batch: EvalBatchRecord, trigger: HTMLElement) => void;
}) {
  const t = useTranslations("evals");
  const placeholder = t("placeholder");
  const twoSelected = selected.length >= 2;

  return (
    <div style={s.scroll}>
      <table style={s.table}>
        <thead>
          <tr style={s.headRow}>
            <th style={s.th} scope="col">
              {t("recentRuns.columns.select")}
            </th>
            <th style={s.th} scope="col">
              {t("recentRuns.columns.ranAt")}
            </th>
            <th style={s.th} scope="col">
              {t("recentRuns.columns.version")}
            </th>
            <th style={s.th} scope="col">
              {t("recentRuns.columns.status")}
            </th>
            <th style={s.th} scope="col">
              {t("tiles.recall")}
            </th>
            <th style={s.th} scope="col">
              {t("tiles.precision")}
            </th>
            <th style={s.th} scope="col">
              {t("tiles.citationAccuracy")}
            </th>
            <th style={s.th} scope="col">
              {t("recentRuns.columns.passed")}
            </th>
            <th style={s.th} scope="col">
              {t("tiles.cost")}
            </th>
            <th style={s.th} scope="col">
              {t("recentRuns.columns.detail")}
            </th>
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => {
            const isSelected = selected.includes(b.id);
            const checkboxDisabled = twoSelected && !isSelected;
            const colors = statusBadgeColors(b.status);
            const dateLabel = b.ran_at.slice(0, 10);
            return (
              <tr key={b.id} style={s.row}>
                <td style={s.td}>
                  {b.status === "done" && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={checkboxDisabled}
                      onChange={(e) => onToggleSelect(b.id, e.target.checked)}
                      aria-label={t("recentRuns.selectRow", { version: b.agent_version, date: dateLabel })}
                    />
                  )}
                </td>
                <td className="mono" style={s.td}>
                  {dateLabel}
                </td>
                <td className="mono" style={s.td}>
                  {t("recentRuns.version", { version: b.agent_version })}
                </td>
                <td style={s.td}>
                  <Badge color={colors.color} bg={colors.bg}>
                    {t(`recentRuns.status.${b.status}`)}
                  </Badge>
                </td>
                <td style={s.td}>{formatRatioTile(b.recall, placeholder)}</td>
                <td style={s.td}>{formatRatioTile(b.precision, placeholder)}</td>
                <td style={s.td}>{formatRatioTile(b.citation_accuracy, placeholder)}</td>
                <td style={s.td}>{passedLabel(b.cases_passed, b.cases_total, placeholder)}</td>
                <td style={s.td}>{formatCostTile(b.cost_usd, placeholder)}</td>
                <td style={s.td}>
                  <Button kind="ghost" size="sm" icon="Eye" onClick={(e) => onOpenDetail(b, e.currentTarget)}>
                    {t("recentRuns.detailButton", { version: b.agent_version, date: dateLabel })}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
