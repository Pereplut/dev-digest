import { z } from 'zod';
import { Severity } from './findings.js';
import { FindingRecord } from './review-api.js';

/**
 * A5 — Observability / Multi-agent contracts (L07; reshaped by spec 0021).
 *
 * These sit alongside A2's `review-api.ts`:
 *   - MultiAgentRun        GET /multi-agent/:id — one fan-out: columns + conflict groups
 *   - MultiAgentRunRef     the lightweight reference GET /multi-agent/latest returns
 *   - AgentColumn          one agent's column in the multi-agent view
 *   - Conflict / ConflictTake  findings grouped by file + overlapping line range
 *   - AgentStats           per-agent quality aggregates (GET /agents/:id/stats)
 *   - CuratorResult        the cross-session memory curator outcome
 *
 * A fan-out is triggered through `POST /pulls/:id/review` with `agent_ids`
 * (see `ReviewRunResponse.multi_run_id`); there is no separate trigger route.
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

export const AgentColumnStatus = z.enum(['running', 'done', 'failed', 'cancelled']);
export type AgentColumnStatus = z.infer<typeof AgentColumnStatus>;

/**
 * One agent's result column. `agent_id` / `agent_name` are null when the agent
 * was deleted after the run (the run row survives with `agent_id` set null).
 * `cost_usd` is a JSON number — the `numeric` column is converted in the repository.
 */
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: AgentColumnStatus,
  error: z.string().nullable(),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(FindingRecord),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/** One run's stance on a group of findings. Keyed by run, not agent (a deleted agent still has a column). */
export const ConflictTake = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  persona: z.string().nullable(),
  /** Highest severity the run flagged in the group, or 'ignored' when it flagged none. */
  verdict: z.union([Severity, z.literal('ignored')]),
  /** The flagged finding's title for the verdict severity; '' when ignored. */
  note: z.string(),
  /** Every finding of this run in the group (ids resolve through `columns[].findings`). */
  finding_ids: z.array(z.string()),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/**
 * A group of findings on one file whose line ranges (widened by 2) overlap,
 * transitively. `divergent` is true when the takes' verdicts are not all equal.
 * Computed from persisted findings; not stored.
 */
export const Conflict = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  title: z.string(),
  divergent: z.boolean(),
  takes: z.array(ConflictTake),
});
export type Conflict = z.infer<typeof Conflict>;

/** Response of GET /multi-agent/:id. */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int(),
  pr_title: z.string(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  total_duration_ms: z.number().int(),
  total_cost_usd: z.number().nullable(),
  columns: z.array(AgentColumn),
  conflicts: z.array(Conflict),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

/** A run without its columns — enough to link to it. */
export const MultiAgentRunRef = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int(),
  ran_at: z.string(),
});
export type MultiAgentRunRef = z.infer<typeof MultiAgentRunRef>;

/** Response of GET /multi-agent/latest[?pr_id=]. `run` is null when none exists. */
export const MultiAgentLatest = z.object({ run: MultiAgentRunRef.nullable() });
export type MultiAgentLatest = z.infer<typeof MultiAgentLatest>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings. */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** recent runs for a small trend chart (oldest→newest). */
  trend: z.array(StatPoint),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;
