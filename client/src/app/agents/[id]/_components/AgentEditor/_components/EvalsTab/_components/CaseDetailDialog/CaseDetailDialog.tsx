/* CaseDetailDialog — per-case detail for one past sweep, opened from a
   recent-runs row (AC-73 – AC-81). Reuses the existing `useEvalBatch` hook
   (0019's `GET /eval-runs/:batchId`) rather than a new route. Deliberately
   renders no part of each run's raw model-output field and no finding text —
   that payload is fetched (0019's route returns it) but never displayed
   here (AC-81). */
"use client";

import { useTranslations } from "next-intl";
import type { EvalRunRecord } from "@devdigest/shared";
import { EmptyState, ErrorState, Modal, Skeleton } from "@/components/ui-client";
import { ApiError } from "@/lib/api";
import { useEvalBatch } from "@/lib/hooks/evals";
import { formatRatioTile } from "../../helpers";
import { s } from "./styles";

function passText(pass: boolean | null, t: (key: string) => string): string {
  return pass === true ? t("caseList.pass") : pass === false ? t("caseList.fail") : t("caseList.notRun");
}

export function CaseDetailDialog({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const t = useTranslations("evals");
  const placeholder = t("placeholder");
  const { data, isLoading, isError, error, refetch } = useEvalBatch(batchId);

  return (
    <Modal title={t("caseDetail.title")} onClose={onClose}>
      {isLoading && (
        <div role="status" aria-label={t("caseDetail.loading")} style={s.loading}>
          <Skeleton height={80} />
        </div>
      )}

      {isError && !isLoading && (
        <ErrorState
          body={error instanceof ApiError ? error.message : t("caseDetail.loadError")}
          onRetry={() => void refetch()}
        />
      )}

      {!isLoading && !isError && data && (
        <>
          {data.runs.length === 0 ? (
            <EmptyState title={t("caseDetail.empty")} />
          ) : (
            <>
              {data.runs.length < data.batch.cases_total && (
                <p style={s.note}>
                  {t("caseDetail.deletedNote", { count: data.batch.cases_total - data.runs.length })}
                </p>
              )}
              <ul style={s.list}>
                {data.runs.map((r: EvalRunRecord) => (
                  <li key={r.id} style={s.row}>
                    <span style={s.name} title={r.case_name ?? undefined}>
                      {r.case_name ?? placeholder}
                    </span>
                    <span style={s.pass(r.pass)}>{passText(r.pass, t)}</span>
                    <span style={s.metric}>{formatRatioTile(r.recall, placeholder)}</span>
                    <span style={s.metric}>{formatRatioTile(r.precision, placeholder)}</span>
                    <span style={s.metric}>{formatRatioTile(r.citation_accuracy, placeholder)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
