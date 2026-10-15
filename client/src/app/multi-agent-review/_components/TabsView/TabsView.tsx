/* Tabs view — one tab per agent column: summary card over that agent's findings
   rendered with the existing FindingCard (AC-39). Switching tabs is local state;
   nothing is posted. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CircularScore } from "@/components/ui-client";
import { formatUsd } from "@/components/run-cost-badge";
import { formatSeconds } from "@/lib/utils/multiAgentEstimate";
import type { AgentColumn } from "@devdigest/shared";
import { AttributedFinding } from "../AttributedFinding";
import { columnMeta } from "../../helpers";
import { s } from "./styles";

export function TabsView({
  columns,
  prId,
  onViewTrace,
  onActionSettled,
}: {
  columns: AgentColumn[];
  prId: string;
  onViewTrace: (runId: string) => void;
  onActionSettled?: () => void;
}) {
  const t = useTranslations("multiAgentReview");
  const [selected, setSelected] = React.useState<string | null>(null);
  // Derived, never synced: a refetch that drops the selected run falls back to the first.
  const column = columns.find((c) => c.run_id === selected) ?? columns[0];
  if (!column) return null;
  const nameOf = (c: AgentColumn) => c.agent_name ?? t("column.unknownAgent");

  return (
    <div style={s.root}>
      <div role="tablist" aria-label={t("tabs.label")} style={s.tabList}>
        {columns.map((c) => (
          <button
            key={c.run_id}
            type="button"
            role="tab"
            id={`ma-tab-${c.run_id}`}
            aria-selected={c.run_id === column.run_id}
            aria-controls={`ma-panel-${c.run_id}`}
            style={s.tab(c.run_id === column.run_id)}
            onClick={() => setSelected(c.run_id)}
          >
            {nameOf(c)}
            {c.score != null && <span style={s.score}>{c.score}</span>}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`ma-panel-${column.run_id}`}
        aria-labelledby={`ma-tab-${column.run_id}`}
        style={s.list}
      >
        <div style={s.summary}>
          {column.score != null && <CircularScore score={column.score} size={44} />}
          <div style={s.summaryMain}>
            <div style={s.name}>{nameOf(column)}</div>
            <div style={s.text}>{column.summary ?? t("tabs.noSummary")}</div>
            {column.status === "failed" && <div style={s.error}>{column.error ?? t("column.failed")}</div>}
            {column.status === "cancelled" && <div style={s.text}>{t("column.cancelled")}</div>}
          </div>
          <div style={s.side}>
            <button type="button" style={s.linkBtn} onClick={() => onViewTrace(column.run_id)}>
              {t("column.viewTrace")}
            </button>
            <span>{columnMeta(column, { seconds: formatSeconds, cost: formatUsd })}</span>
          </div>
        </div>
        {column.findings.map((f) => (
          <AttributedFinding
            key={f.id}
            finding={f}
            agentName={column.agent_name}
            prId={prId}
            onSettled={onActionSettled}
          />
        ))}
      </div>
    </div>
  );
}
