import type { ChartSeries } from "@/components/ui-client";
import type { EvalBatchRecord, EvalCase, EvalRunRecord, EvalTrendPoint, RunEvent } from "@devdigest/shared";

/**
 * The agent's latest batch is whatever the server returns at element 0 of
 * `GET /agents/:id/eval-runs` — never re-sorted here (AC-74). A `latest_batch`
 * field is never read from the case-list response either; this is the only
 * source.
 */
export function latestBatch(batches: readonly EvalBatchRecord[]): EvalBatchRecord | undefined {
  return batches[0];
}

/**
 * The latest batch that actually finished. Scans the server's own (already
 * newest-first) order for the first `done` entry — a `cancelled` or still-live
 * batch never masquerades as a result (AC-73): its partial numbers stay on its
 * own row, but the tiles and the case list's pass state read the last
 * completed sweep.
 */
export function latestCompletedBatch(batches: readonly EvalBatchRecord[]): EvalBatchRecord | undefined {
  return batches.find((b) => b.status === "done");
}

export function isBatchLive(batch: EvalBatchRecord | undefined): boolean {
  return batch?.status === "queued" || batch?.status === "running";
}

/** recall / precision / citation_accuracy as a whole-number percent, or the i18n placeholder. */
export function formatRatioTile(value: number | null | undefined, placeholder: string): string {
  if (value == null || !Number.isFinite(value)) return placeholder;
  return `${Math.round(value * 100)}%`;
}

/**
 * The cost tile. Mirrors `formatUsd`'s (`@/components/run-cost-badge`) number
 * formatting, but the "unknown" case renders the CALLER'S placeholder rather
 * than a hardcoded "—", so the empty-message-catalogue test (AC-62) can tell
 * the difference between copy that went through next-intl and copy that did
 * not.
 */
export function formatCostTile(value: number | null | undefined, placeholder: string): string {
  if (value == null || !Number.isFinite(value) || value < 0) return placeholder;
  if (value === 0) return "$0.000";
  if (value >= 0.001) return `$${value.toFixed(3)}`;
  const decimals = 1 - Math.floor(Math.log10(value));
  return `$${value.toFixed(decimals)}`;
}

/** "passed/total" for the Passed tile, or the placeholder when there is no completed batch. */
export function passedLabel(
  passed: number | null | undefined,
  total: number | null | undefined,
  placeholder: string,
): string {
  if (passed == null || total == null) return placeholder;
  return `${passed}/${total}`;
}

/** "file:line" (single line) or "file:start-end", never overflowing — truncated by CSS. */
export function expectedRangeLabel(
  c: Pick<EvalCase, "expected_file" | "expected_start_line" | "expected_end_line">,
): string {
  const range =
    c.expected_start_line === c.expected_end_line
      ? `${c.expected_start_line}`
      : `${c.expected_start_line}-${c.expected_end_line}`;
  return `${c.expected_file}:${range}`;
}

/** Per-case pass state from a batch detail's runs, keyed by case id. */
export function passByCaseId(runs: readonly Pick<EvalRunRecord, "case_id" | "pass">[]): Map<string, boolean | null> {
  return new Map(runs.map((r) => [r.case_id, r.pass]));
}

/** The structured payload the executor attaches to each per-case verdict event. */
interface EvalCaseEventData {
  evalCase: { index: number; total: number; pass: boolean };
}

function hasEvalCaseData(data: unknown): data is EvalCaseEventData {
  if (typeof data !== "object" || data === null) return false;
  const evalCase = (data as { evalCase?: unknown }).evalCase;
  if (typeof evalCase !== "object" || evalCase === null) return false;
  const { index, total } = evalCase as { index?: unknown; total?: unknown };
  return typeof index === "number" && typeof total === "number";
}

/**
 * Completed-case count from the live SSE stream (AC-59). Counts the
 * STRUCTURED per-case verdict field (`data.evalCase`) the executor attaches
 * to each per-case verdict event, not the human-readable message — matching
 * on the message text would silently stop advancing the moment that prose is
 * reworded or translated, since `RunEvent.data` (contracts/trace.ts) is
 * exactly the channel built for this.
 *
 * A per-case verdict arrives as EITHER a `result` event (the normal
 * pass/fail path) OR an `error` event (a provider exception for that case —
 * `eval-run-executor.ts`'s catch block, published via `runLog.error`); both
 * carry the same `data.evalCase` shape, so counting is keyed on the presence
 * of that field rather than on `kind` alone — otherwise a sweep with any
 * per-case provider error would stall short of its real total. The batch's
 * own terminal event (`kind: 'result'`, "Run complete"/"Run cancelled by
 * user") carries no `evalCase` field, so it is never double-counted; `info`/
 * `tool` events are excluded outright since the executor never attaches
 * `evalCase` to them.
 */
export function countCompletedCases(events: readonly RunEvent[]): number {
  return events.filter((e) => (e.kind === "result" || e.kind === "error") && hasEvalCaseData(e.data)).length;
}

// ===========================================================================
// Trend chart (spec 0020, AC-42 – AC-44, AC-66, AC-67)
// ===========================================================================

const TREND_SERIES = [
  { key: "recall" as const, color: "var(--accent)" },
  { key: "precision" as const, color: "var(--ok)" },
  { key: "citationAccuracy" as const, color: "var(--warn)" },
];

export interface TrendSeriesResult {
  series: ChartSeries[];
  /** Points this helper itself dropped for an incomplete metric triple — the
   * CLIENT half of AC-83's duplicated predicate (the server counts the same
   * thing over every batch, not just the ones `trend` returns). */
  dropped: number;
}

/**
 * Three index-aligned, equal-length series from `trend`. A point with ANY
 * null metric is dropped from all three series (never just its own), because
 * `LineChart`'s series are positional arrays sharing one hidden index axis —
 * dropping from one alone would slide every later point in that series onto
 * the wrong x-position (`client/src/vendor/ui/charts/LineChart.tsx:31-38`,
 * spec `## Edge cases`). Every surviving value is a real, finite number
 * (AC-66): `LineChart` itself coerces a missing element to `0`, which this
 * helper exists specifically to prevent reaching it.
 */
export function toTrendSeries(trend: readonly EvalTrendPoint[]): TrendSeriesResult {
  const kept = trend.filter(
    (p) => p.recall != null && p.precision != null && p.citation_accuracy != null,
  );
  const series: ChartSeries[] = TREND_SERIES.map(({ key, color }) => ({
    name: key,
    color,
    data: kept.map((p) => {
      const value = key === "recall" ? p.recall : key === "precision" ? p.precision : p.citation_accuracy;
      return value as number;
    }),
  }));
  return { series, dropped: trend.length - kept.length };
}

/** Fewer than two points on any series → render the empty state, not the chart (AC-44). */
export function plottable(series: readonly ChartSeries[]): boolean {
  return (series[0]?.data.length ?? 0) >= 2;
}

// ===========================================================================
// Delta tiles (spec 0020, AC-39, AC-40, AC-52 – AC-54)
// ===========================================================================

/**
 * A signed delta as percentage points, e.g. `"+2.1pt"` / `"-2.0pt"` — direction
 * is conveyed in TEXT (AC-40), not only by the colour `deltaColor` returns. A
 * `null`/non-finite delta renders the caller's placeholder with no sign and no
 * direction word (AC-39).
 */
export function formatDeltaTile(value: number | null | undefined, placeholder: string): string {
  if (value == null || !Number.isFinite(value)) return placeholder;
  const pts = value * 100;
  const sign = pts > 0 ? "+" : "";
  return `${sign}${pts.toFixed(1)}pt`;
}

/** A signed dollar delta, e.g. `"+$0.001"` / `"-$0.002"` (compare modal's cost tile). */
export function formatCostDeltaTile(value: number | null | undefined, placeholder: string): string {
  if (value == null || !Number.isFinite(value)) return placeholder;
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(3)}`;
}

/** Colour for a delta's text (decoration ONLY — AC-40's text already carries the sign). */
export function deltaColor(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return "var(--text-muted)";
  return value > 0 ? "var(--ok)" : "var(--crit)";
}

/** The specific metric delta (as percentage points, unsigned) an alert code refers to. */
export function alertDeltaPoints(
  code: string,
  delta: { recall: number | null; precision: number | null; citation_accuracy: number | null },
): string {
  const raw =
    code === "recall_drop" ? delta.recall : code === "precision_drop" ? delta.precision : delta.citation_accuracy;
  return raw == null ? "0.0" : Math.abs(raw * 100).toFixed(1);
}
