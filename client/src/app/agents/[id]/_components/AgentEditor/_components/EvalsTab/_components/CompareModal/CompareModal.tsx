/* CompareModal — two batches, side by side: four delta tiles and a
   system-prompt diff (AC-50 – AC-63), plus the promote confirmation as a
   SECOND STEP inside this same `Modal` (AC-69 – AC-72) rather than a second
   stacked one — `getByRole("dialog")` throws on two matches, which is the
   query AC-51's and AC-69's own tests are told to use. Renders no part of
   `old`/`new`'s findings (there are none in this response, AC-27) and no
   markdown/HTML interpretation of either prompt (AC-57): both render as
   plain text through React's default escaping. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api";
import { toDiffRows } from "@/lib/text-diff";
import { Button, ErrorState, Modal, Skeleton } from "@/components/ui-client";
import { usePromoteAgentVersion } from "@/lib/hooks/agents";
import { useEvalCompare } from "@/lib/hooks/evals";
import {
  deltaColor,
  formatCostDeltaTile,
  formatCostTile,
  formatDeltaTile,
  formatRatioTile,
} from "../../helpers";
import { INCOMPARABLE_REASON_KEY } from "../../constants";
import { hasPromptChange } from "./helpers";
import { DIFF_MARK, s } from "./styles";

function MetricTile({
  label,
  oldValue,
  newValue,
  delta,
  placeholder,
}: {
  label: string;
  oldValue: number | null;
  newValue: number | null;
  delta: number | null;
  placeholder: string;
}) {
  // AC-53: either side null forces the delta to the placeholder too, even if
  // the server happened to send a number for the other reason — a tile never
  // shows a delta next to a value it is also showing as "unknown".
  const deltaText = oldValue == null || newValue == null ? placeholder : formatDeltaTile(delta, placeholder);
  return (
    <div style={s.tile}>
      <div style={s.tileLabel}>{label}</div>
      <div style={s.tileRow}>
        <span>{formatRatioTile(oldValue, placeholder)}</span>
        <span aria-hidden>→</span>
        <span>{formatRatioTile(newValue, placeholder)}</span>
      </div>
      <span style={s.tileDelta(deltaColor(delta))}>{deltaText}</span>
    </div>
  );
}

function CostTile({
  oldValue,
  newValue,
  delta,
  label,
  placeholder,
}: {
  oldValue: number | null;
  newValue: number | null;
  delta: number | null;
  label: string;
  placeholder: string;
}) {
  const deltaText = oldValue == null || newValue == null ? placeholder : formatCostDeltaTile(delta, placeholder);
  return (
    <div style={s.tile}>
      <div style={s.tileLabel}>{label}</div>
      <div style={s.tileRow}>
        <span>{formatCostTile(oldValue, placeholder)}</span>
        <span aria-hidden>→</span>
        <span>{formatCostTile(newValue, placeholder)}</span>
      </div>
      <span style={s.tileDelta(deltaColor(delta))}>{deltaText}</span>
    </div>
  );
}

export function CompareModal({
  agentId,
  pair,
  agentVersion,
  onClose,
}: {
  agentId: string;
  /** The two batch ids to compare — always present: `EvalsTab` only ever
   * mounts this component once both are selected and Compare is activated. */
  pair: [string, string];
  agentVersion: number;
  onClose: () => void;
}) {
  const t = useTranslations("evals");
  // Owning the query here (rather than taking `comparison`/`isLoading`/
  // `isError` as three separate props from `EvalsTab`) is what makes the
  // bug this replaces unrepresentable: those three booleans came from one
  // `useQuery` result and could never actually disagree, but nothing in
  // their TYPES said so, and the guard below checked them in the wrong
  // order against exactly that assumption. With one hook call there is one
  // source of truth and only one place the ordering can be gotten right.
  const { data: comparison, isLoading, isError, refetch } = useEvalCompare(agentId, pair);
  const promote = usePromoteAgentVersion(agentId);
  const [confirming, setConfirming] = React.useState(false);
  const [promotedVersion, setPromotedVersion] = React.useState<number | null>(null);
  const placeholder = t("placeholder");

  // Checked BEFORE the loading/no-data branch. On a failed query, TanStack
  // sets `isLoading` false and leaves `data` undefined — so `isLoading ||
  // !comparison` alone matches a failure too, and the modal would show the
  // loading skeleton forever with no way to retry (found independently by
  // three reviewers). `refetch` gives the error state a real way out. Its
  // OWN title — "Comparison unavailable" — not `loadingTitle`: that read
  // "Loading comparison…" above a failure message once this branch became
  // reachable.
  if (isError) {
    return (
      <Modal title={t("compare.errorTitle")} onClose={onClose}>
        <ErrorState body={t("compare.loadError")} onRetry={() => void refetch()} />
      </Modal>
    );
  }

  if (isLoading || !comparison) {
    return (
      <Modal title={t("compare.loadingTitle")} onClose={onClose}>
        {/* `role="status"` takes its accessible name ONLY from `aria-label`/
            `aria-labelledby`, never from content (client/INSIGHTS.md:144-151)
            — an explicit label is required, not optional. Also what the
            regression test asserts on, rather than the vendored `Skeleton`'s
            own `.skeleton` class (an internal of code this repo forbids
            touching, `client/src/vendor/ui/primitives/Skeleton.tsx:13`). */}
        <div role="status" aria-label={t("compare.loadingStatus")} style={s.loadingBody}>
          <Skeleton height={140} />
        </div>
      </Modal>
    );
  }

  const { old, new: newer, old_config, new_config, comparable, incomparable_reason, delta } = comparison;
  const title = t("compare.title", { oldVersion: old.agent_version, newVersion: newer.agent_version });
  const rows = old_config && new_config ? toDiffRows(old_config.system_prompt, new_config.system_prompt) : [];
  const promptChanged = hasPromptChange(rows);
  const newIsCurrent = newer.agent_version === agentVersion;
  const noConfig = !new_config;
  const promoteDisabled = newIsCurrent || noConfig;
  const promoteDisabledReason = newIsCurrent
    ? t("compare.promoteDisabledCurrent")
    : noConfig
      ? t("compare.promoteDisabledNoConfig")
      : null;

  if (confirming) {
    const confirmError = promote.isError
      ? promote.error instanceof ApiError
        ? promote.error.message
        : t("compare.promoteGenericError")
      : null;
    return (
      <Modal
        title={title}
        onClose={onClose}
        footer={
          <div style={s.footer}>
            <Button kind="ghost" onClick={() => setConfirming(false)}>
              {t("promoteConfirm.cancel")}
            </Button>
            <Button
              kind="primary"
              loading={promote.isPending}
              onClick={() =>
                promote.mutate(newer.agent_version, {
                  onSuccess: (result) => {
                    setPromotedVersion(result.version);
                    setConfirming(false);
                  },
                })
              }
            >
              {t("promoteConfirm.confirm")}
            </Button>
          </div>
        }
      >
        <p style={s.confirmBody}>
          {t("promoteConfirm.body", {
            version: newer.agent_version,
            model: new_config?.model ?? "",
            count: new_config?.skills.length ?? 0,
          })}
        </p>
        {confirmError && <p style={s.error}>{confirmError}</p>}
      </Modal>
    );
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {promotedVersion != null && (
            <span style={s.success}>{t("compare.promoteSuccess", { version: promotedVersion })}</span>
          )}
          {promoteDisabledReason && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{promoteDisabledReason}</span>}
          <Button kind="primary" disabled={promoteDisabled} onClick={() => setConfirming(true)}>
            {t("compare.promoteLabel", { version: newer.agent_version })}
          </Button>
        </div>
      }
    >
      {!comparable && (
        <div style={s.warning}>
          {t(INCOMPARABLE_REASON_KEY[incomparable_reason ?? ""] ?? "compare.reasons.unknown")}
        </div>
      )}

      <div style={s.tiles}>
        <MetricTile label={t("tiles.recall")} oldValue={old.recall} newValue={newer.recall} delta={delta.recall} placeholder={placeholder} />
        <MetricTile
          label={t("tiles.precision")}
          oldValue={old.precision}
          newValue={newer.precision}
          delta={delta.precision}
          placeholder={placeholder}
        />
        <MetricTile
          label={t("tiles.citationAccuracy")}
          oldValue={old.citation_accuracy}
          newValue={newer.citation_accuracy}
          delta={delta.citation_accuracy}
          placeholder={placeholder}
        />
        <CostTile label={t("tiles.cost")} oldValue={old.cost_usd} newValue={newer.cost_usd} delta={delta.cost_usd} placeholder={placeholder} />
      </div>

      {!old_config || !new_config ? (
        <p style={s.notice}>{t("compare.configMissing")}</p>
      ) : !promptChanged ? (
        <p style={s.notice}>{t("compare.noPromptChange")}</p>
      ) : (
        <div className="mono" style={s.diffBox}>
          {rows.map((r, i) => (
            // Index keys are safe: the rows are derived, static and never reordered.
            <div key={i} style={s.diffRow(r.kind)}>
              <span style={s.diffMark} aria-hidden>
                {DIFF_MARK[r.kind]}
              </span>
              <span>{r.text || " "}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
