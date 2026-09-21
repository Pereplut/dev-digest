/* SkillCard — one skill in the Skills Lab list column (design tab_3): type-tinted
   icon, mono name, the global enabled switch, a one-line description, type badge
   + source label, and the "N agents · X% pull · Y% accept" footer. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Skill } from "@devdigest/shared";
import { Badge, Icon, Toggle } from "@/components/ui-client";
import { SkillTypeIcon } from "../SkillTypeIcon/SkillTypeIcon";
import { SOURCE_META, TYPE_BG, TYPE_COLOR, acceptColor, formatRate } from "../../_lib/skill-meta";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  onClick: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const source = SOURCE_META[skill.source];
  const SourceIcon = Icon[source.icon];
  const stats = skill.stats;

  return (
    // Not a real <button>: the card contains the Toggle (itself a button), and
    // nesting buttons is invalid HTML. Same pattern as AgentCard.
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      onKeyDown={(ev) => {
        // Keys pressed on the nested toggle bubble here too; leave them to it.
        if (ev.target !== ev.currentTarget) return;
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault(); // Space would otherwise scroll the list
          onClick();
        }
      }}
      style={s.card(!!active, skill.enabled)}
    >
      <div style={s.headerRow}>
        <SkillTypeIcon type={skill.type} />
        <span className="mono" style={s.name}>
          {skill.name}
        </span>
        {/* A <label> gives the kit Toggle (no aria-label prop) an accessible name. */}
        <label style={s.toggle} onClick={(e) => e.stopPropagation()}>
          <span style={s.srOnly}>{t("card.toggleLabel", { name: skill.name })}</span>
          <Toggle on={skill.enabled} onChange={onToggle} size={14} />
        </label>
      </div>
      <div style={s.description}>{skill.description || t("card.noDescription")}</div>
      <div style={s.metaRow}>
        <Badge color={TYPE_COLOR[skill.type]} bg={TYPE_BG[skill.type]}>
          {t(`type.${skill.type}`)}
        </Badge>
        <span style={s.source}>
          <SourceIcon size={12} aria-hidden />
          {t(`source.${source.labelKey}`)}
        </span>
      </div>
      <div style={s.footer}>
        <span>{t("card.agents", { count: stats?.agent_count ?? 0 })}</span>
        <span>{t("card.pull", { rate: formatRate(stats?.pull_rate) })}</span>
        <span style={s.accept(acceptColor(stats?.accept_rate))}>
          {t("card.accept", { rate: formatRate(stats?.accept_rate) })}
        </span>
      </div>
    </div>
  );
}
