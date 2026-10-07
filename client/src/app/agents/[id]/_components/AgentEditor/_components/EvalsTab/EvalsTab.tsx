/* EvalsTab — the agent's eval harness (spec 0019). Five metric tiles from the
   latest COMPLETED batch (a cancelled sweep never masquerades as a result),
   the case list with per-case pass state from that same batch, and
   "Run all evals" — a confirmed, real-money action streamed over the same
   runBus a review run uses (`useRunEvents`, hooks/reviews.ts). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Badge, Button, ErrorState, MetricCard, Modal, Skeleton } from "@/components/ui-client";
import { useAgentEvalBatches, useAgentEvalCases, useEvalBatch, useRunEvals } from "@/lib/hooks/evals";
import { useRunEvents } from "@/lib/hooks/reviews";
import { EXPECTATION_KIND_LABEL_KEY } from "./constants";
import {
  countCompletedCases,
  expectedRangeLabel,
  formatCostTile,
  formatRatioTile,
  isBatchLive,
  latestBatch,
  latestCompletedBatch,
  passByCaseId,
  passedLabel,
} from "./helpers";
import { s } from "./styles";

export function EvalsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("evals");
  const ta = useTranslations("agents");
  const qc = useQueryClient();

  // Every hook is called unconditionally, every render (rules of hooks) — only
  // the VALUES handed to them (an id that may be undefined, an `enabled` flag
  // implied by that id) vary with the data that has loaded so far.
  const cases = useAgentEvalCases(agentId);
  const batches = useAgentEvalBatches(agentId);
  const allBatches = batches.data ?? [];
  const latest = latestBatch(allBatches);
  const completed = latestCompletedBatch(allBatches);
  const live = isBatchLive(latest);
  const detail = useEvalBatch(completed?.id);
  const { events, running } = useRunEvents(live && latest ? [latest.id] : []);
  const runEvals = useRunEvals(agentId);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const wasRunning = React.useRef(false);

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
        <Button kind="primary" icon="FlaskConical" disabled={runDisabled} onClick={() => setConfirmOpen(true)}>
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

      {confirmOpen && (
        <Modal
          title={t("runConfirm.title", { count: allCases.length })}
          subtitle={t("runConfirm.body")}
          onClose={() => setConfirmOpen(false)}
          footer={
            <div style={s.confirmFooter}>
              <Button kind="ghost" onClick={() => setConfirmOpen(false)}>
                {t("runConfirm.cancel")}
              </Button>
              <Button
                kind="primary"
                loading={runEvals.isPending}
                onClick={() => runEvals.mutate(undefined, { onSuccess: () => setConfirmOpen(false) })}
              >
                {t("runConfirm.confirm")}
              </Button>
            </div>
          }
        />
      )}
    </div>
  );
}
