/* "Where agents disagree" — one row per finding group, one cell per run that
   finished (AC-41). Everything the model wrote (titles, notes, files) is
   rendered as text children — no markdown, no innerHTML (AC-42). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, SeverityBadge } from "@/components/ui-client";
import type { AgentColumn, Conflict } from "@devdigest/shared";
import { AttributedFinding } from "../AttributedFinding";
import { locationLabel, resolveFindings, visibleConflicts } from "./helpers";
import { s } from "./styles";

export function DisagreeBlock({
  conflicts,
  columns,
  prId,
  onActionSettled,
}: {
  conflicts: Conflict[];
  columns: AgentColumn[];
  prId: string;
  onActionSettled?: () => void;
}) {
  const t = useTranslations("multiAgentReview");
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);
  const [open, setOpen] = React.useState<Set<number>>(new Set());
  const nameOf = (runId: string) =>
    columns.find((c) => c.run_id === runId)?.agent_name ?? t("column.unknownAgent");

  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(i)) next.add(i);
      return next;
    });

  // Keep each group's original index as its identity so filtering never shifts what is expanded.
  const rows = conflicts.map((c, i) => ({ c, i }));
  const shown = visibleConflicts(conflicts, onlyConflicts);

  return (
    <section aria-label={t("disagree.title")} style={s.root}>
      <div style={s.head}>
        <h2 style={s.title}>{t("disagree.title")}</h2>
        <label style={s.toggle}>
          <input type="checkbox" checked={onlyConflicts} onChange={(e) => setOnlyConflicts(e.target.checked)} />
          {t("disagree.onlyConflicts")}
        </label>
      </div>
      {conflicts.length === 0 && <div style={s.empty}>{t("disagree.empty")}</div>}
      {conflicts.length > 0 && shown.length === 0 && <div style={s.empty}>{t("disagree.noConflicts")}</div>}
      {rows
        .filter(({ c }) => shown.includes(c))
        .map(({ c, i }) => {
          const loc = locationLabel(c);
          const expanded = open.has(i);
          return (
            <div key={i} style={s.group} data-divergent={c.divergent}>
              <div style={s.groupHead}>
                <Icon.Code size={13} style={{ color: "var(--text-muted)" }} />
                <span className="mono" style={s.location}>
                  {loc}
                </span>
                <span style={s.groupTitle}>{c.title}</span>
                <button
                  type="button"
                  style={s.expandBtn}
                  aria-expanded={expanded}
                  aria-label={t(expanded ? "disagree.collapse" : "disagree.expand", { location: loc })}
                  onClick={() => toggle(i)}
                >
                  <Icon.ChevronDown size={15} style={{ transform: expanded ? "rotate(180deg)" : undefined }} />
                </button>
              </div>
              <div style={s.takes}>
                {c.takes.map((take) => (
                  <div key={take.run_id} style={s.take}>
                    <span style={s.takeAgent}>{nameOf(take.run_id)}</span>
                    {take.verdict === "ignored" ? (
                      <Badge dot color="var(--text-muted)" bg="transparent">
                        {t("disagree.didNotFlag")}
                      </Badge>
                    ) : (
                      <SeverityBadge severity={take.verdict} />
                    )}
                    {take.note !== "" && <span style={s.note}>{take.note}</span>}
                  </div>
                ))}
              </div>
              {expanded && (
                <div style={s.expanded}>
                  {c.takes.flatMap((take) =>
                    resolveFindings(take.run_id, take.finding_ids, columns).map((f) => (
                      <AttributedFinding
                        key={f.id}
                        finding={f}
                        agentName={columns.find((col) => col.run_id === take.run_id)?.agent_name ?? null}
                        prId={prId}
                        onSettled={onActionSettled}
                      />
                    )),
                  )}
                </div>
              )}
            </div>
          );
        })}
    </section>
  );
}
