import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { Intent, SmartDiff } from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

// ---- Intent layer (spec 0008) ----

/**
 * Closed set. A closed taxonomy is what makes the classification usable
 * downstream: `unknown` is a real answer, and the UI says so rather than
 * showing an invented purpose.
 */
export const IntentCategory = z.enum([
  'feature',
  'bugfix',
  'refactor',
  'performance',
  'security',
  'docs',
  'test',
  'chore',
  'dependency',
  'revert',
  'unknown',
]);
export type IntentCategory = z.infer<typeof IntentCategory>;

/**
 * Computed by the SERVER from which sources were available — the model is never
 * asked for a number (spec 0008, decision D1). Deterministic, so the same PR
 * always bands the same way and the UI can explain why.
 */
export const IntentConfidence = z.enum(['high', 'medium', 'low']);
export type IntentConfidence = z.infer<typeof IntentConfidence>;

export const IntentSourceKind = z.enum([
  'title',
  'body',
  'issue',
  'spec',
  'commits',
  'branch',
  'paths',
]);
export type IntentSourceKind = z.infer<typeof IntentSourceKind>;

/**
 * One input the classifier was given — including one it could NOT read. An
 * unreadable linked spec caps the confidence band and is shown in the UI; it is
 * never silently dropped.
 */
export const IntentSource = z.object({
  kind: IntentSourceKind,
  /** Path, issue reference or branch name, depending on `kind`. */
  ref: z.string(),
  chars: z.number().int().nonnegative(),
  truncated: z.boolean(),
  status: z.enum(['used', 'unreadable', 'empty']),
});
export type IntentSource = z.infer<typeof IntentSource>;

/**
 * A quote the model returned, re-checked server-side against the exact text that
 * was sent. Anthropic's Citations API cannot be combined with structured
 * outputs in one request, so verification is ours to do. A quote that fails is
 * kept with `valid: false` rather than dropped — hiding it would make a weak
 * intent look better grounded than it is.
 */
export const IntentEvidence = z.object({
  source_kind: IntentSourceKind,
  ref: z.string(),
  quote: z.string(),
  valid: z.boolean(),
});
export type IntentEvidence = z.infer<typeof IntentEvidence>;

/** Intent persisted for a PR (the Intent plus the pr_id it scopes). */
export const PrIntentRecord = Intent.extend({
  pr_id: z.string(),
  category: IntentCategory,
  confidence: IntentConfidence,
  /** One line, ≤ 400 chars. Null when the model returned none. */
  rationale: z.string().nullish(),
  sources: z.array(IntentSource),
  evidence: z.array(IntentEvidence),
  head_sha: z.string().nullish(),
  model: z.string().nullish(),
  /** Kept here and in the trace only; never folded into `agent_runs.cost_usd`. */
  cost_usd: z.number().nullish(),
  derived_at: z.string(),
});
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/** `GET /pulls/:id/intent`. Null when nothing has been derived for this PR yet. */
export const PrIntentResponse = z.object({ intent: PrIntentRecord.nullable() });
export type PrIntentResponse = z.infer<typeof PrIntentResponse>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;
