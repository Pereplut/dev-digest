import type { EvalExpectationKind } from "@devdigest/shared";

/** `evals.json` key for each expectation kind label — exhaustive over the enum. */
export const EXPECTATION_KIND_LABEL_KEY = {
  must_find: "expectationKind.mustFind",
  must_not_flag: "expectationKind.mustNotFlag",
} satisfies Record<EvalExpectationKind, string>;

/**
 * The fixed alert threshold the server applies (AC-16's constant, mirrored
 * for display only — no comparison happens client-side; `alert` always
 * arrives pre-computed from `GET /agents/:id/eval-dashboard`).
 */
export const ALERT_THRESHOLD = -0.02;

/** Known `EvalDashboard.alert` codes (spec 0020, AC-16). */
type AlertCode = "recall_drop" | "precision_drop" | "citation_drop";

const ALERT_MESSAGE_KEY_MAP = {
  recall_drop: "alert.recallDrop",
  precision_drop: "alert.precisionDrop",
  citation_drop: "alert.citationDrop",
} satisfies Record<AlertCode, string>;

/**
 * Widened to an arbitrary-string lookup (`client/INSIGHTS.md:194-200`) because
 * `EvalDashboard.alert` is `z.string().nullable()`, not a closed union — a
 * future server-side code this map does not yet know must look up as
 * `undefined`, not throw.
 */
export const ALERT_MESSAGE_KEY: Readonly<Record<string, string | undefined>> = ALERT_MESSAGE_KEY_MAP;

/**
 * Known `EvalRunComparison.incomparable_reason` codes (spec 0020, AC-24,
 * AC-89, AC-90). `metrics_version_unrecorded` fires when EITHER side's
 * formula was never stamped (a batch from before `metrics_version` existed);
 * `metrics_version_mismatch` only once both sides ARE recorded and differ —
 * `server/src/modules/evals/helpers.ts:459-469`. Each needs its own message:
 * a legacy batch's numbers were never comparable to begin with, which is a
 * different fact from "we know both formulas and they disagree".
 */
type IncomparableReasonCode = "metrics_version_mismatch" | "metrics_version_unrecorded";

const INCOMPARABLE_REASON_KEY_MAP = {
  metrics_version_mismatch: "compare.reasons.metricsVersionMismatch",
  metrics_version_unrecorded: "compare.reasons.metricsVersionUnrecorded",
} satisfies Record<IncomparableReasonCode, string>;

export const INCOMPARABLE_REASON_KEY: Readonly<Record<string, string | undefined>> =
  INCOMPARABLE_REASON_KEY_MAP;
