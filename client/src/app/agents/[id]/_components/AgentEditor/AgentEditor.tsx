/* AgentEditor — the agent editor shell: tab bar + the active tab (Config or
   Skills). Tab state lives in ?tab= (owned by the page). Evals/Stats/CI are
   not built yet and stay out of TABS. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@/components/ui-client";
import type { Agent } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { SkillsTab } from "./_components/SkillsTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function AgentEditor({ agent, tab, onTab }: { agent: Agent; tab: string; onTab: (t: string) => void }) {
  const t = useTranslations("agents");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        {/* `key` remounts the tab when the agent changes, which is what resets
            its local state. ConfigTab previously did that with an effect that
            fired nine setState calls on [agent.id] — rendering the previous
            agent's values for one frame on every switch. */}
        {tab === "skills" ? (
          <SkillsTab key={agent.id} agentId={agent.id} />
        ) : (
          <ConfigTab key={agent.id} agent={agent} />
        )}
      </div>
    </div>
  );
}
