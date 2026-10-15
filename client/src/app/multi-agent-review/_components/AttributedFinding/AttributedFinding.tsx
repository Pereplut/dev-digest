/* One finding labelled with the agent that raised it: the PR page's FindingCard
   (confidence, rationale, suggested fix, Accept / Dismiss / Turn into eval case)
   plus Learn / Reply, which are rendered disabled — no backend yet (AC-40). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui-client";
// FindingCard is imported in place from the PR route (spec 0021 decision Q2: not moved
// to src/components) so this feature does not widen the merge surface with other branches.
import { FindingCard } from "@/app/repos/[repoId]/pulls/[number]/_components/FindingCard";
import { useFindingAction } from "@/lib/hooks/reviews";
import type { FindingRecord } from "@devdigest/shared";
import { s } from "./styles";

export function AttributedFinding({
  finding,
  agentName,
  prId,
  onSettled,
}: {
  finding: FindingRecord;
  /** The raising agent's name; null renders "Unknown agent". */
  agentName: string | null;
  prId: string;
  /** Called when an Accept / Dismiss request settles, so the run is refetched. */
  onSettled?: () => void;
}) {
  const t = useTranslations("multiAgentReview");
  const action = useFindingAction();
  const soonId = `soon-${finding.id}`;

  return (
    <div style={s.root} data-agent-finding={finding.id}>
      <span style={s.label}>
        {t("finding.reportedBy", { agent: agentName ?? t("column.unknownAgent") })}
      </span>
      <FindingCard
        f={finding}
        pending={action.isPending}
        onAction={(kind, reply) =>
          action.mutate(
            { findingId: finding.id, action: kind, reply, prId },
            { onSettled: () => onSettled?.() },
          )
        }
      />
      <div style={s.actions}>
        <Button kind="ghost" size="sm" icon="Lightbulb" disabled aria-describedby={soonId} title={t("finding.comingSoon")}>
          {t("finding.learn")}
        </Button>
        <Button kind="ghost" size="sm" icon="MessageSquare" disabled aria-describedby={soonId} title={t("finding.comingSoon")}>
          {t("finding.reply")}
        </Button>
        <span id={soonId} style={s.soon}>
          {t("finding.comingSoon")}
        </span>
      </div>
    </div>
  );
}
