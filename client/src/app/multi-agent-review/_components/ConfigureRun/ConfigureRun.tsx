/* Configure run — pick a PR and the agents to fan out (spec 0021, AC-30..34).
   The PR list is the ACTIVE repo's (the list API is per repo); `?pr=` preselects
   a PR even from another repo through its detail query. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, EmptyState, SelectInput } from "@/components/ui-client";
import { useAgents } from "@/lib/hooks/agents";
import { usePullDetail, usePulls } from "@/lib/hooks/core";
import { useRunReview } from "@/lib/hooks/reviews";
import { useActiveRepo } from "@/lib/repo-context";
import {
  formatAgentEstimate,
  formatCost,
  formatSeconds,
  summariseEstimate,
} from "@/lib/utils/multiAgentEstimate";
import { MIN_AGENTS } from "./constants";
import { buildPrOptions, prOptionLabel, toggleId } from "./helpers";
import { s } from "./styles";

export function ConfigureRun({ initialPrId }: { initialPrId?: string | null }) {
  const t = useTranslations("multiAgentReview");
  const router = useRouter();
  const { repoId } = useActiveRepo();
  const { data: pulls } = usePulls(repoId);
  const { data: preselected } = usePullDetail(initialPrId ?? null);
  const { data: agents } = useAgents();
  const run = useRunReview();
  const [prId, setPrId] = React.useState(initialPrId ?? "");
  const [checked, setChecked] = React.useState<string[]>([]);

  const enabled = (agents ?? []).filter((a) => a.enabled);
  const options = buildPrOptions(
    pulls ?? [],
    preselected?.id
      ? { id: preselected.id, number: preselected.number, title: preselected.title }
      : null,
  );
  const picked = enabled.filter((a) => checked.includes(a.id));
  const summary = summariseEstimate(picked);
  const canRun = prId !== "" && checked.length >= MIN_AGENTS && !run.isPending;

  const start = async () => {
    const res = await run.mutateAsync({ prId, agentIds: checked });
    if (res.multi_run_id) router.push(`/multi-agent-review/${res.multi_run_id}`);
  };

  return (
    <div style={s.page}>
      <h1 style={s.h1}>{t("configure.title")}</h1>
      <p style={s.subtitle}>{t("configure.subtitle")}</p>

      <div style={s.stepHead}>
        <span style={s.stepNo}>1</span>
        <span style={s.stepTitle}>{t("configure.stepPr")}</span>
      </div>
      <div style={s.select} role="group" aria-label={t("configure.prLabel")}>
        <SelectInput
          mono={false}
          value={prId}
          onChange={(v) => setPrId(v)}
          options={[
            { value: "", label: t("configure.prPlaceholder") },
            ...options.map((o) => ({ value: o.id, label: prOptionLabel(o) })),
          ]}
        />
      </div>

      <div style={s.stepHead}>
        <span style={s.stepNo}>2</span>
        <span style={s.stepTitle}>{t("configure.stepAgents")}</span>
        {prId !== "" && enabled.length > 0 && (
          <button type="button" style={s.textBtn} onClick={() => setChecked(enabled.map((a) => a.id))}>
            {t("configure.selectAll")}
          </button>
        )}
      </div>

      {prId === "" ? (
        <div style={s.empty}>
          <EmptyState icon="GitPullRequest" title={t("configure.emptyTitle")} body={t("configure.emptyBody")} />
        </div>
      ) : enabled.length === 0 ? (
        <p style={s.hint}>{t("configure.noAgents")}</p>
      ) : (
        <div style={s.cards}>
          {enabled.map((a) => (
            <div key={a.id} style={s.card(checked.includes(a.id))}>
              <Checkbox
                checked={checked.includes(a.id)}
                onChange={() => setChecked((ids) => toggleId(ids, a.id))}
                label={a.name}
              />
              <div style={s.cardMain}>
                <div style={s.cardDesc}>{a.description}</div>
              </div>
              <span style={s.cardEst}>{formatAgentEstimate(a) ?? t("configure.noHistory")}</span>
            </div>
          ))}
        </div>
      )}

      <div style={s.footer}>
        <Button kind="primary" icon="Users" disabled={!canRun} loading={run.isPending} onClick={start}>
          {t("configure.run", { count: checked.length })}
        </Button>
        {summary && (
          <span className="mono" style={s.summary}>
            {summary.cost_usd == null
              ? t("configure.summaryNoCost", { duration: formatSeconds(summary.duration_ms) })
              : t("configure.summary", {
                  duration: formatSeconds(summary.duration_ms),
                  cost: formatCost(summary.cost_usd),
                })}
          </span>
        )}
      </div>
      {checked.length < MIN_AGENTS && prId !== "" && <p style={{ ...s.hint, marginTop: 10 }}>{t("configure.needTwo")}</p>}
    </div>
  );
}
