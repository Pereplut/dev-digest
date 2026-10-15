/* CiVerdictBadge — the verdict cell of a CI run. A run whose status is
   `failed` renders "Failed" in place of the verdict (spec 0022 AC-92), since
   its verdict is not meaningful. Shared by the /ci table and the agent CI tab. */
"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui-client";
import type { CiRun } from "@devdigest/shared";

type Props = { run: Pick<CiRun, "status" | "verdict"> };

export function CiVerdictBadge({ run }: Props) {
  const t = useTranslations("ci");
  if (run.status === "failed") {
    return (
      <Badge color="var(--crit)" bg="var(--crit-bg)" icon="XCircle">
        {t("runs.verdict.failed")}
      </Badge>
    );
  }
  if (run.verdict === "request_changes") {
    return (
      <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
        {t("runs.verdict.requestChanges")}
      </Badge>
    );
  }
  return (
    <Badge color="var(--ok)" bg="var(--ok-bg)" icon="CheckCircle">
      {t("runs.verdict.approve")}
    </Badge>
  );
}
