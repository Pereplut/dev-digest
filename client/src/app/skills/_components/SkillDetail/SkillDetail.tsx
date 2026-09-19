/* SkillDetail — the selected skill's pane: header (type icon, mono name, type
   badge, vN pill) and the shipped tabs from constants.ts. Context, Evals and the
   "Run on evals" action stay hidden until they are built (spec 0006). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Skill } from "@devdigest/shared";
import { Badge, Tabs } from "@/components/ui-client";
import { SkillTypeIcon } from "../SkillTypeIcon/SkillTypeIcon";
import { SkillForm } from "../SkillForm/SkillForm";
import { PreviewTab } from "./_components/PreviewTab/PreviewTab";
import { StatsTab } from "./_components/StatsTab/StatsTab";
import { VersionsTab } from "./_components/VersionsTab/VersionsTab";
import { TYPE_BG, TYPE_COLOR } from "../../_lib/skill-meta";
import { SHIPPED_TABS, type SkillTab } from "./constants";
import { parseTab } from "./helpers";
import { s } from "./styles";

function TabBody({ skill, tab }: { skill: Skill; tab: SkillTab }) {
  switch (tab) {
    case "config":
      // Keyed by version so a save or a restore re-seeds the form from the server.
      return <SkillForm key={`${skill.id}:${skill.version}`} skill={skill} />;
    case "preview":
      return <PreviewTab skill={skill} />;
    case "stats":
      return <StatsTab skillId={skill.id} />;
    case "versions":
      return <VersionsTab skill={skill} />;
  }
}

export function SkillDetail({
  skill,
  tab,
  onTab,
}: {
  skill: Skill;
  tab: SkillTab;
  onTab: (tab: SkillTab) => void;
}) {
  const t = useTranslations("skills");
  const tabs = SHIPPED_TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey) }));
  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <SkillTypeIcon type={skill.type} size={30} />
        <h1 className="mono" style={s.name}>
          {skill.name}
        </h1>
        <Badge color={TYPE_COLOR[skill.type]} bg={TYPE_BG[skill.type]}>
          {t(`type.${skill.type}`)}
        </Badge>
        <Badge icon="GitCommit" mono>
          {t("detail.version", { version: skill.version })}
        </Badge>
        {!skill.enabled && <Badge color="var(--text-muted)">{t("detail.disabled")}</Badge>}
      </div>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={(k) => onTab(parseTab(k))} />
      </div>
      <div style={s.body}>
        <TabBody skill={skill} tab={tab} />
      </div>
    </div>
  );
}
