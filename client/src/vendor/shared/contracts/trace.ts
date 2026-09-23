import { z } from 'zod';

/**
 * Run trace. The ENTIRE trace of one run is persisted as a SINGLE
 * jsonb document in `run_traces` (not per-row). Live events stream via SSE
 * during the run; the full log is written once on completion.
 */

export const RunEventKind = z.enum(['info', 'tool', 'result', 'error']);
export type RunEventKind = z.infer<typeof RunEventKind>;

/** A single live-log line. `t` = elapsed timestamp string (e.g. "00.31"). */
export const RunLogLine = z.object({
  t: z.string(),
  kind: RunEventKind,
  msg: z.string(),
});
export type RunLogLine = z.infer<typeof RunLogLine>;

/** SSE payload streamed on `/runs/:id/events`. */
export const RunEvent = z.object({
  runId: z.string(),
  seq: z.number().int(),
  kind: RunEventKind,
  msg: z.string(),
  t: z.string(),
  data: z.unknown().optional(),
});
export type RunEvent = z.infer<typeof RunEvent>;

export const ToolCall = z.object({
  tool: z.string(),
  args: z.string(),
  meta: z.string().nullish(),
  ms: z.number().int(),
});
export type ToolCall = z.infer<typeof ToolCall>;

export const PromptAssembly = z.object({
  /** Agent system prompt + injection guard, WITHOUT the skills block (it has its own slot). */
  system: z.string(),
  /** `## Skills` block the engine places inside the system message, before the guard. */
  skills: z.string().nullish(),
  memory: z.string().nullish(),
  specs: z.string().nullish(),
  /** Callers-of-changed-symbols digest (repo-intel); null when absent. */
  callers: z.string().nullish(),
  /** Repo skeleton / map (repo-intel); null when absent. */
  repo_map: z.string().nullish(),
  /** PR author's description/body (truncated); null when absent. */
  pr_description: z.string().nullish(),
  /**
   * Derived-intent block (spec 0008); null when absent — including when the
   * classifier failed, which is the normal fail-open path. Sits after
   * `pr_description`, which it summarises, and before the code context.
   */
  intent: z.string().nullish(),
  user: z.string(),
});
export type PromptAssembly = z.infer<typeof PromptAssembly>;

export const MemoryPulled = z.object({
  pr: z.number().int().nullish(),
  text: z.string(),
});
export type MemoryPulled = z.infer<typeof MemoryPulled>;

export const RunStats = z.object({
  duration_ms: z.number().int(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  findings: z.number().int(),
  grounding: z.string(),
  // USD spent on the run; null = unknown price. Absent in traces written
  // before run cost was persisted.
  cost_usd: z.number().nullish(),
});
export type RunStats = z.infer<typeof RunStats>;

export const SkillUsed = z.object({
  id: z.string().nullable(),
  name: z.string(),
  version: z.number().int(),
  tokens: z.number().int(),
});
export type SkillUsed = z.infer<typeof SkillUsed>;

/** One intent classification, as recorded in a run's trace (spec 0008). */
export const IntentCall = z.object({
  provider: z.string(),
  model: z.string(),
  /** True when a stored intent matched the input hash, so no model was called. */
  reused: z.boolean(),
  duration_ms: z.number().int().nonnegative(),
  tokens_in: z.number().int().nonnegative().nullish(),
  tokens_out: z.number().int().nonnegative().nullish(),
  cost_usd: z.number().nullish(),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type IntentCall = z.infer<typeof IntentCall>;

/** The single-document trace stored in `run_traces.trace`. */
export const RunTrace = z.object({
  config: z.object({
    agent: z.string(),
    version: z.string().nullish(),
    provider: z.string().nullish(),
    model: z.string(),
    pr: z.number().int().nullish(),
    source: z.enum(['local', 'ci']).default('local'),
  }),
  stats: RunStats,
  prompt_assembly: PromptAssembly,
  tool_calls: z.array(ToolCall),
  raw_output: z.string(),
  memory_pulled: z.array(MemoryPulled),
  specs_read: z.array(z.string()),
  log: z.array(RunLogLine),
  /** Skills appended to the system message, in prompt order. Absent in traces before spec 0006. */
  skills_used: z.array(SkillUsed).nullish(),
  /** Token estimate per prompt_assembly slot (cl100k). Absent in traces before spec 0006. */
  prompt_tokens: z.record(z.string(), z.number().int()).nullish(),
  /**
   * The intent classification call (spec 0008). Null when it was not run, or
   * when it failed — the review proceeds either way, so this is how a silent
   * fail-open is noticed. `reused` means a stored intent matched the input hash
   * and no model was called. The cost is recorded here and on the `pr_intent`
   * row, deliberately NOT in `agent_runs.cost_usd`: one call serves N agents.
   */
  intent_call: IntentCall.nullish(),
});
export type RunTrace = z.infer<typeof RunTrace>;

/**
 * One row of a PR's run history (every agent_runs row, any status). Surfaced on
 * the PR page so runs — including FAILED ones with their error — survive reload.
 */
export const RunSummary = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.string().nullable(), // running | done | failed | cancelled
  error: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  // USD spent on the run; null = unknown price, or a failed/cancelled run.
  cost_usd: z.number().nullable(),
  findings_count: z.number().int().nullable(),
  grounding: z.string().nullable(),
  ran_at: z.string().nullable(),
  // Review outcome, denormalized onto the run row at completion (the timeline
  // has no FK to the review). score = the review's 0-100 score; blockers =
  // findings that trip the agent's gate. Null on failed/cancelled runs.
  score: z.number().int().nullable(),
  blockers: z.number().int().nullable(),
});
export type RunSummary = z.infer<typeof RunSummary>;
