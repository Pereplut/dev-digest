/* EvalsTab — the agent's eval harness (spec 0019) plus the per-agent eval
   dashboard and compare-two-runs modal (spec 0020). 0019's five tiles,
   case list and "Run all evals" control are unchanged below; everything from
   the delta tiles down is new.

   One `role="dialog"` at a time (spec 0020 Decision 2): `dialog` is a
   single-slot state covering 0019's run-confirm modal plus the new compare
   modal and case-detail dialog, because `getByRole("dialog")` throws on two
   matches and that is the query every one of these tests is told to use. The
   promote confirmation renders as a second step INSIDE the already-open
   compare modal (see CompareModal), never as a second stacked `Modal`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Badge, Button, ErrorState, LineChart, MetricCard, Modal, Skeleton } from "@/components/ui-client";
import {
  useAgentEvalBatches,
  useAgentEvalCases,
  useAgentEvalDashboard,
  useEvalBatch,
  useEvalCompare,
  useRunEvals,
} from "@/lib/hooks/evals";
import { useRunEvents } from "@/lib/hooks/reviews";
import { CaseDetailDialog } from "./_components/CaseDetailDialog";
import { CompareModal } from "./_components/CompareModal";
import { RecentRunsTable } from "./_components/RecentRunsTable";
import { ALERT_MESSAGE_KEY, EXPECTATION_KIND_LABEL_KEY } from "./constants";
import {
  alertDeltaPoints,
  countCompletedCases,
  deltaColor,
  expectedRangeLabel,
  formatCostTile,
  formatDeltaTile,
  formatRatioTile,
  isBatchLive,
  latestBatch,
  latestCompletedBatch,
  passByCaseId,
  passedLabel,
  plottable,
  toTrendSeries,
} from "./helpers";
import { s } from "./styles";

/**
 * One MetricCard's `value` slot: the current value and its delta, each in
 * its OWN `<span>` so a null value's placeholder and a null delta's
 * placeholder render as two independently queryable text nodes rather than
 * one combined string (AC-38, AC-39).
 */
function DeltaTileValue({ current, delta, placeholder }: { current: number | null; delta: number | null; placeholder: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}>
      <span>{formatRatioTile(current, placeholder)}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: deltaColor(delta) }}>{formatDeltaTile(delta, placeholder)}</span>
    </span>
  );
}

type DialogState =
  | { kind: "none" }
  | { kind: "runConfirm" }
  | { kind: "compare"; pair: [string, string] }
  | { kind: "caseDetail"; batchId: string };

export function EvalsTab({ agentId, agentVersion }: { agentId: string; agentVersion: number }) {
  const t = useTranslations("evals");
  const ta = useTranslations("agents");
  const qc = useQueryClient();

  // Every hook is called unconditionally, every render (rules of hooks) — only
  // the VALUES handed to them (an id that may be undefined, an `enabled` flag
  // implied by that id) vary with the data that has loaded so far.
  const cases = useAgentEvalCases(agentId);
  const batches = useAgentEvalBatches(agentId);
  const dashboard = useAgentEvalDashboard(agentId);
  const allBatches = batches.data ?? [];
  const latest = latestBatch(allBatches);
  const completed = latestCompletedBatch(allBatches);
  const live = isBatchLive(latest);
  const detail = useEvalBatch(completed?.id);
  const { events, running } = useRunEvents(live && latest ? [latest.id] : []);
  const runEvals = useRunEvals(agentId);

  const [dialog, setDialog] = React.useState<DialogState>({ kind: "none" });
  const [selected, setSelected] = React.useState<string[]>([]);
  const openerRef = React.useRef<HTMLElement | null>(null);
  const wasRunning = React.useRef(false);

  const closeDialog = React.useCallback(() => {
    setDialog({ kind: "none" });
    openerRef.current?.focus();
    openerRef.current = null;
  }, []);

  // AC-64: Escape closes the compare modal / case-detail dialog and returns
  // focus to the control that opened it. The vendored `Modal` has no keydown
  // handler, no focus trap and no focus restore of its own
  // (client/src/vendor/ui/kit/Modal.tsx) — this is the caller's to implement,
  // precedent `AddRepoView.tsx:25-31`. 0019's run-confirm modal is unchanged.
  React.useEffect(() => {
    if (dialog.kind !== "compare" && dialog.kind !== "caseDetail") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog.kind, closeDialog]);

  const comparePair = dialog.kind === "compare" ? dialog.pair : null;
  const compare = useEvalCompare(agentId, comparePair);

  // The stream's own `running` flag — not the cached `latest.status` — is the
  // only signal that a sweep just ended: the batch row the UI is holding is
  // whatever it was when the stream opened, and nothing else refetches it
  // (specs/0019-evals.md's edge-case note: "the tab refetches `GET
  // /eval-runs/:batchId` on stream completion"). Without this, a finished run
  // (or one that failed, e.g. a missing provider key) never lands: `live`
  // stays true forever, "Run all evals" stays disabled, the tiles keep their
  // placeholders and the progress badge freezes — recoverable only by reload.
  React.useEffect(() => {
    if (running) {
      wasRunning.current = true;
      return;
    }
    if (!wasRunning.current) return;
    // Reset BEFORE invalidating, matching RunStatus.tsx: `latest` is a fresh
    // value every render (derived from query data that is about to change),
    // so without this guard the effect re-fires on every subsequent render
    // and re-invalidates in a loop.
    wasRunning.current = false;
    void qc.invalidateQueries({ queryKey: ["agent-eval-batches", agentId] });
    if (latest) void qc.invalidateQueries({ queryKey: ["eval-batch", latest.id] });
  }, [running, qc, agentId, latest]);

  if (cases.isError || batches.isError) {
    return (
      <ErrorState
        title={t("loadError")}
        onRetry={() => {
          void cases.refetch();
          void batches.refetch();
        }}
      />
    );
  }
  // Gate on isLoading, not on a falsy `data` — a cached read in flight must
  // never render as "no cases"/"no batches" (client/INSIGHTS.md:187-192).
  if (cases.isLoading || batches.isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={24} width={220} />
        <Skeleton height={140} style={{ marginTop: 16 }} />
      </div>
    );
  }

  const allCases = cases.data ?? [];
  const placeholder = t("placeholder");
  const passMap = passByCaseId(detail.data?.runs ?? []);
  const runDisabled = allCases.length === 0 || live || runEvals.isPending;

  const dash = dashboard.data;
  const trendSeries = dash ? toTrendSeries(dash.trend).series : [];
  const canPlot = plottable(trendSeries);

  function toggleSelect(batchId: string, checked: boolean) {
    setSelected((prev) => {
      if (checked) return prev.length >= 2 ? prev : [...prev, batchId];
      return prev.filter((id) => id !== batchId);
    });
  }

  function openCaseDetail(batch: { id: string }, trigger: HTMLElement) {
    openerRef.current = trigger;
    setDialog({ kind: "caseDetail", batchId: batch.id });
  }

  function openCompare(e: React.MouseEvent<HTMLButtonElement>) {
    const [a, b] = selected;
    if (!a || !b) return;
    openerRef.current = e.currentTarget;
    setDialog({ kind: "compare", pair: [a, b] });
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{ta("editor.tabs.evals")}</h2>
        {live && latest && (
          <Badge color="var(--accent-text)" bg="var(--accent-bg)">
            {t("progress", { done: countCompletedCases(events), total: latest.cases_total })}
          </Badge>
        )}
        <div style={s.spacer} />
        <Button
          kind="primary"
          icon="FlaskConical"
          disabled={runDisabled}
          onClick={() => setDialog({ kind: "runConfirm" })}
        >
          {t("runAll")}
        </Button>
      </div>

      <div style={s.tiles}>
        <MetricCard label={t("tiles.recall")} value={formatRatioTile(completed?.recall, placeholder)} />
        <MetricCard label={t("tiles.precision")} value={formatRatioTile(completed?.precision, placeholder)} />
        <MetricCard
          label={t("tiles.citationAccuracy")}
          value={formatRatioTile(completed?.citation_accuracy, placeholder)}
        />
        <MetricCard
          label={t("tiles.passed")}
          value={passedLabel(completed?.cases_passed, completed?.cases_total, placeholder)}
        />
        <MetricCard label={t("tiles.cost")} value={formatCostTile(completed?.cost_usd, placeholder)} />
      </div>

      {allCases.length === 0 ? (
        <p style={s.empty}>{t("empty")}</p>
      ) : (
        <ul style={s.list}>
          {allCases.map((c) => {
            const pass = passMap.get(c.id) ?? null;
            const passText = pass === true ? t("caseList.pass") : pass === false ? t("caseList.fail") : t("caseList.notRun");
            return (
              <li key={c.id} style={s.row}>
                <span style={s.name} title={c.name}>
                  {c.name}
                </span>
                <Badge>{t(EXPECTATION_KIND_LABEL_KEY[c.expectation_kind])}</Badge>
                <span style={s.range} title={expectedRangeLabel(c)}>
                  {expectedRangeLabel(c)}
                </span>
                <span style={s.pass(pass)}>{passText}</span>
              </li>
            );
          })}
        </ul>
      )}

      {/* --- spec 0020: the per-agent dashboard + compare -------------------- */}
      {dashboard.isLoading ? (
        <Skeleton height={100} style={{ marginTop: 20 }} />
      ) : dashboard.isError ? (
        <ErrorState body={t("loadError")} onRetry={() => void dashboard.refetch()} />
      ) : dash ? (
        <div style={s.dashboardSection}>
          <div style={s.tiles}>
            <MetricCard
              label={t("tiles.recall")}
              value={<DeltaTileValue current={dash.current.recall} delta={dash.delta.recall} placeholder={placeholder} />}
            />
            <MetricCard
              label={t("tiles.precision")}
              value={<DeltaTileValue current={dash.current.precision} delta={dash.delta.precision} placeholder={placeholder} />}
            />
            <MetricCard
              label={t("tiles.citationAccuracy")}
              value={
                <DeltaTileValue current={dash.current.citation_accuracy} delta={dash.delta.citation_accuracy} placeholder={placeholder} />
              }
            />
          </div>

          {dash.alert && (
            <div role="alert" style={s.alertBanner}>
              {t(ALERT_MESSAGE_KEY[dash.alert] ?? "alert.generic", {
                delta: alertDeltaPoints(dash.alert, dash.delta),
              })}
            </div>
          )}

          {canPlot ? (
            <LineChart series={trendSeries} yMin={0} yMax={1} />
          ) : (
            <p style={s.empty}>{t("trend.empty")}</p>
          )}

          {(dash.trend_excluded.other_version > 0 || dash.trend_excluded.incomplete_metrics > 0) && (
            <p style={s.trendNote}>
              {t("trend.excludedOtherVersion", { count: dash.trend_excluded.other_version })}{" "}
              {t("trend.excludedIncomplete", { count: dash.trend_excluded.incomplete_metrics })}
            </p>
          )}

          <div style={s.recentRunsHeader}>
            <h3 style={s.h3}>{t("recentRuns.title")}</h3>
            <Button kind="secondary" disabled={selected.length !== 2} onClick={openCompare}>
              {t("recentRuns.compare")}
            </Button>
          </div>
          <RecentRunsTable
            batches={dash.recent_runs}
            selected={selected}
            onToggleSelect={toggleSelect}
            onOpenDetail={openCaseDetail}
          />
        </div>
      ) : null}

      {dialog.kind === "runConfirm" && (
        <Modal
          title={t("runConfirm.title", { count: allCases.length })}
          subtitle={t("runConfirm.body")}
          onClose={closeDialog}
          footer={
            <div style={s.confirmFooter}>
              <Button kind="ghost" onClick={closeDialog}>
                {t("runConfirm.cancel")}
              </Button>
              <Button
                kind="primary"
                loading={runEvals.isPending}
                onClick={() => runEvals.mutate(undefined, { onSuccess: closeDialog })}
              >
                {t("runConfirm.confirm")}
              </Button>
            </div>
          }
        />
      )}

      {dialog.kind === "compare" && (
        <CompareModal
          comparison={compare.data}
          isLoading={compare.isLoading}
          isError={compare.isError}
          agentId={agentId}
          agentVersion={agentVersion}
          onClose={closeDialog}
        />
      )}

      {dialog.kind === "caseDetail" && <CaseDetailDialog batchId={dialog.batchId} onClose={closeDialog} />}
    </div>
  );
}
