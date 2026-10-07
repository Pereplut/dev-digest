import type { EvalBatchRecord, EvalCase, EvalRunRecord, RunEvent } from "@devdigest/shared";

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
