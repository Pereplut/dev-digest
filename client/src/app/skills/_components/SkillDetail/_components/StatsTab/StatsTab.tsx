/* StatsTab (design tab_4) — usage tiles, the agents that attach the skill, and
   30-day findings by category. Findings are attributed to runs that included the
   skill, not to the skill alone; rates are "—" when there is nothing to divide by. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Cell, Pie, PieChart } from "recharts";
import { CircularScore, ErrorState, Icon, SectionLabel, Skeleton } from "@/components/ui-client";
import { useSkillStats } from "@/lib/hooks/skills";
import { formatRate, ratePercent } from "../../../../_lib/skill-meta";
import { DONUT_SIZE, DONUT_STROKE } from "./constants";
import { toSlices } from "./helpers";
import { s } from "./styles";

function StatTile({
  label,
  value,
  suffix,
  aside,
}: {
  label: string;
  value: React.ReactNode;
  suffix?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div style={s.tile}>
      <div style={s.tileHead}>
        <span style={s.tileLabel}>{label}</span>
        {aside}
      </div>
      <div className="tnum" style={s.tileValue}>
        {value}
        {suffix && <span style={s.tileSuffix}>{suffix}</span>}
      </div>
    </div>
  );
}

/** "71" + "%" when there is a rate, a bare "—" otherwise. */
function RateTile({ label, rate, ring }: { label: string; rate: number | null; ring?: boolean }) {
  const pct = ratePercent(rate);
  return (
    <StatTile
      label={label}
      value={pct == null ? formatRate(rate) : pct}
      suffix={pct == null ? undefined : "%"}
      aside={ring && pct != null ? <CircularScore score={pct} size={40} stroke={4} /> : undefined}
    />
  );
}

export function StatsTab({ skillId }: { skillId: string }) {
  const t = useTranslations("skills");
  const { data: stats, isLoading, isError, refetch } = useSkillStats(skillId);

  if (isLoading) {
    return (
      <div style={s.tiles}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={120} />
        ))}
      </div>
    );
  }
  if (isError || !stats) return <ErrorState body={t("stats.loadError")} onRetry={() => refetch()} />;

  const slices = toSlices(stats.findings_by_category);

  return (
    <div style={s.wrap}>
      <div style={s.tiles}>
        <StatTile
          label={t("stats.usedBy")}
          value={stats.agent_count}
          suffix={t("stats.agentsSuffix", { count: stats.agent_count })}
        />
        <RateTile label={t("stats.pullFrequency")} rate={stats.pull_rate} />
        <RateTile label={t("stats.acceptRate")} rate={stats.accept_rate} ring />
        <StatTile label={t("stats.findings30d")} value={stats.findings_30d} />
      </div>

      <div style={s.panels}>
        <section style={s.panel}>
          <SectionLabel icon="Cpu">{t("stats.agentsTitle")}</SectionLabel>
          {stats.agents.length === 0 ? (
            <p style={s.empty}>{t("stats.agentsEmpty")}</p>
          ) : (
            <ul style={s.agentList}>
              {stats.agents.map((a) => (
                <li key={a.id} style={s.agentRow}>
                  <Icon.Cpu size={15} style={s.agentIcon} aria-hidden />
                  <span style={s.agentName}>{a.name}</span>
                  <Link
                    href={`/agents/${a.id}?tab=skills`}
                    className="mono"
                    style={s.openLink}
                    aria-label={t("stats.openLabel", { name: a.name })}
                  >
                    {t("stats.open")}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={s.panel}>
          <SectionLabel icon="Tag">{t("stats.categoriesTitle")}</SectionLabel>
          {slices.length === 0 ? (
            <p style={s.empty}>{t("stats.categoriesEmpty")}</p>
          ) : (
            <div style={s.donutRow}>
              <div aria-hidden>
                <PieChart width={DONUT_SIZE} height={DONUT_SIZE}>
                  <Pie
                    data={slices}
                    dataKey="count"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    innerRadius={DONUT_SIZE / 2 - DONUT_STROKE}
                    outerRadius={DONUT_SIZE / 2}
                    startAngle={90}
                    endAngle={-270}
                    isAnimationActive={false}
                    stroke="none"
                  >
                    {slices.map((sl) => (
                      <Cell key={sl.category} fill={sl.color} />
                    ))}
                  </Pie>
                </PieChart>
              </div>
              {/* Own legend: the kit Donut formats every value as money (toFixed(2) + "$"). */}
              <ul style={s.legend}>
                {slices.map((sl) => (
                  <li key={sl.category} style={s.legendRow}>
                    <span style={s.swatch(sl.color)} aria-hidden />
                    <span style={s.legendLabel}>{sl.category}</span>
                    <span className="mono tnum" style={s.legendCount}>
                      {sl.count}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p style={s.hint}>{t("stats.attributionHint")}</p>
        </section>
      </div>
    </div>
  );
}
