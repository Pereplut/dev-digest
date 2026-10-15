/* Columns view — one column per agent run (AC-36). Model text (titles, files,
   errors) is rendered only as React text children. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, CircularScore, SeverityBadge } from "@/components/ui-client";
import { formatCost, formatSeconds } from "@/lib/utils/multiAgentEstimate";
import type { AgentColumn } from "@devdigest/shared";
import { columnMeta } from "../../helpers";
import { STATUS_COLOR } from "./helpers";
import { s } from "./styles";

export function ColumnsView({
  columns,
  onViewTrace,
}: {
  columns: AgentColumn[];
  onViewTrace: (runId: string) => void;
}) {
  const t = useTranslations("multiAgentReview");
  return (
    <div style={s.grid}>
      {columns.map((c) => {
        const name = c.agent_name ?? t("column.unknownAgent");
        const meta = columnMeta(c, { seconds: formatSeconds, cost: formatCost });
        return (
          <section key={c.run_id} aria-label={name} style={s.col}>
            <div style={s.head}>
              <div style={s.headMain}>
                <div style={s.name}>{name}</div>
                <div style={s.meta}>{meta}</div>
              </div>
              <Badge color={STATUS_COLOR[c.status].color} bg={STATUS_COLOR[c.status].bg}>
                {t(`column.status.${c.status}`)}
              </Badge>
              {c.score != null && (
                <span role="img" aria-label={t("column.score", { score: c.score })}>
                  <CircularScore score={c.score} size={38} />
                </span>
              )}
            </div>
            <div style={s.body}>
              {c.status === "failed" && <div style={s.error}>{c.error ?? t("column.failed")}</div>}
              {c.status === "cancelled" && <div style={s.note}>{t("column.cancelled")}</div>}
              {c.findings.map((f) => (
                <div key={f.id} style={s.row}>
                  <SeverityBadge severity={f.severity} />
                  <span style={s.rowTitle}>{f.title}</span>
                  <span className="mono" style={s.rowFile}>
                    {f.file}:{f.start_line}
                  </span>
                </div>
              ))}
              {c.status === "done" && c.findings.length === 0 && (
                <div style={s.note}>{t("column.noFindings")}</div>
              )}
            </div>
            <div style={s.foot}>
              <button type="button" style={s.linkBtn} onClick={() => onViewTrace(c.run_id)}>
                {t("column.viewTrace")}
              </button>
              <span>{t("column.findingsCount", { count: c.findings.length })}</span>
            </div>
          </section>
        );
      })}
    </div>
  );
}
