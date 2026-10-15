/* Results for one multi-agent run (spec 0021, AC-35..42). The run is polled by
   `useMultiAgentRun` while any column runs; the SSE stream of each running run
   additionally triggers an immediate refetch when it closes. */
"use client";

import React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, ErrorState, Skeleton } from "@/components/ui-client";
import { AppShell } from "@/components/app-shell";
import RunTraceDrawer from "@/components/run-trace-drawer";
import { useMultiAgentRun } from "@/lib/hooks/multiAgentReview";
import { useRunEvents } from "@/lib/hooks/reviews";
import { formatCost, formatSeconds } from "@/lib/utils/multiAgentEstimate";
import { ColumnsView } from "../ColumnsView";
import { DisagreeBlock } from "../DisagreeBlock";
import { TabsView } from "../TabsView";
import { VIEWS, type View } from "./constants";
import { configureHref, runningRunIds } from "./helpers";
import { s } from "./styles";

export function ResultsView({ id }: { id: string }) {
  const t = useTranslations("multiAgentReview");
  const router = useRouter();
  const search = useSearchParams();
  const { data: run, isLoading, isError, refetch } = useMultiAgentRun(id);
  const [view, setView] = React.useState<View>("columns");

  // Subscribe only to runs still in flight; when their streams close, refetch now
  // rather than waiting for the next poll.
  const running = run ? runningRunIds(run.columns) : [];
  const { running: streaming } = useRunEvents(running);
  const wasStreaming = React.useRef(false);
  React.useEffect(() => {
    if (wasStreaming.current && !streaming) void refetch();
    wasStreaming.current = streaming;
  }, [streaming, refetch]);

  const crumb = [
    { label: t("results.crumbRoot"), href: "/multi-agent-review" },
    ...(run ? [{ label: `#${run.pr_number}`, mono: true }] : []),
  ];

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div role="status" aria-label={t("results.loading")} style={s.center}>
          <Skeleton height={28} width={320} />
        </div>
      </AppShell>
    );
  }
  if (isError || !run) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("results.errorTitle")}
          body={t("results.errorBody")}
          onRetry={() => void refetch()}
        />
      </AppShell>
    );
  }

  const traceId = search.get("trace");
  const traceColumn = traceId ? run.columns.find((c) => c.run_id === traceId) : undefined;
  const setTrace = (runId: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (runId) sp.set("trace", runId);
    else sp.delete("trace");
    router.replace(`/multi-agent-review/${id}${sp.toString() ? `?${sp.toString()}` : ""}`);
  };
  const onActionSettled = () => void refetch();
  const cost = run.total_cost_usd == null ? "–" : formatCost(run.total_cost_usd);

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div>
          <div style={s.titleRow}>
            <Link href={configureHref(run.pr_id)} style={s.configure}>
              <Icon.Settings size={13} />
              {t("results.configureRun")}
            </Link>
            <h1 style={s.h1}>{t("results.title")}</h1>
            <span style={s.sub}>{t("results.selectedAgents", { count: run.agent_count })}</span>
            <div role="group" aria-label={t("results.views")} style={s.toggle}>
              {VIEWS.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  style={s.toggleBtn(view === v)}
                  onClick={() => setView(v)}
                >
                  {t(`results.${v}`)}
                </button>
              ))}
            </div>
          </div>
          <div style={{ ...s.prRow, marginTop: 12 }}>
            <span className="mono" style={s.prNumber}>
              #{run.pr_number}
            </span>
            <span style={s.prTitle}>{run.pr_title}</span>
            <span style={s.totals}>
              {t("results.totals", { duration: formatSeconds(run.total_duration_ms), cost })}
            </span>
          </div>
        </div>

        {view === "columns" ? (
          <ColumnsView columns={run.columns} onViewTrace={setTrace} />
        ) : (
          <TabsView
            columns={run.columns}
            prId={run.pr_id}
            onViewTrace={setTrace}
            onActionSettled={onActionSettled}
          />
        )}
        <DisagreeBlock
          conflicts={run.conflicts}
          columns={run.columns}
          prId={run.pr_id}
          onActionSettled={onActionSettled}
        />
      </div>

      {traceColumn && (
        <RunTraceDrawer
          runId={traceColumn.run_id}
          prNumber={run.pr_number}
          findings={traceColumn.findings}
          agentName={traceColumn.agent_name}
          running={traceColumn.status === "running"}
          onClose={() => setTrace(null)}
        />
      )}
    </AppShell>
  );
}
