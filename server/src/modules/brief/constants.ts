/**
 * PR Brief module constants (spec 0018).
 */

/** `completeStructured({ timeoutMs })` — the portable bound. Only OpenRouter
 *  honours an abort `signal` (server/INSIGHTS.md 2026-09-30), so the timeout
 *  is what actually stops a hung generation on every provider. */
export const BRIEF_TIMEOUT_MS = 60_000;

/** AC-4 — the whole prompt (every `messages[].content`), counted with
 *  `container.tokenizer.count()` before the one `completeStructured` call. */
export const BRIEF_INPUT_TOKEN_BUDGET = 8_000;

/** AC-50 — prompt-level instructions only, never a validation cap (AC-51). */
export const BRIEF_MAX_RISKS = 5;
export const BRIEF_MAX_FOCUS = 6;

/** `completeStructured({ schemaName })` — the mock adapter's lookup key. */
export const BRIEF_SCHEMA_NAME = 'PrBriefGeneration';

/**
 * Whole-block drop order under budget pressure (lowest-value first), exactly
 * as `## Non-functional` states it. `intent` and the PR title are never
 * dropped, and neither is the blast radius `summary` string — only its
 * caller list is droppable (`blast_callers`) — so none of the three appear
 * here.
 */
export const TRUNCATION_ORDER = [
  'specs',
  'smart_diff',
  'blast_callers',
  'issue',
  'pr_body',
  'diff_stats',
] as const;
export type FactBlockName = (typeof TRUNCATION_ORDER)[number];
