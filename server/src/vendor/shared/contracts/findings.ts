import { z } from 'zod';

/**
 * Review / Findings contracts.
 * These Zod schemas are the single source of truth for:
 *  - API request/response validation,
 *  - LLM structured output (`response_format` / forced tool-use),
 *  - shared web↔api types.
 */

export const Severity = z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']);
export type Severity = z.infer<typeof Severity>;

export const FindingCategory = z.enum(['bug', 'security', 'perf', 'style', 'test']);
export type FindingCategory = z.infer<typeof FindingCategory>;

export const FindingKind = z.enum([
  'finding',
  'secret_leak',
  'lethal_trifecta',
  'phantom',
  'hook',
]);
export type FindingKind = z.infer<typeof FindingKind>;

export const Verdict = z.enum(['request_changes', 'approve', 'comment']);
export type Verdict = z.infer<typeof Verdict>;

export const TrifectaComponent = z.enum([
  'private_data_access',
  'untrusted_input',
  'exfil_path',
]);
export type TrifectaComponent = z.infer<typeof TrifectaComponent>;

export const TrifectaEvidence = z.object({
  component: TrifectaComponent,
  file: z.string(),
  line: z.number().int(),
});
export type TrifectaEvidence = z.infer<typeof TrifectaEvidence>;

/**
 * Finding — the atomic review unit. `start_line`/`end_line` are used by the
 * citation-grounding gate (must intersect a real diff hunk for diff-findings).
 */
export const Finding = z.object({
  id: z.string(),
  severity: Severity,
  category: FindingCategory,
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  rationale: z.string(), // markdown
  suggestion: z.string().nullish(), // markdown
  confidence: z.number().min(0).max(1),
  kind: FindingKind.nullish(),
  // Lethal-trifecta variant fields (present only when kind === 'lethal_trifecta')
  trifecta_components: z.array(TrifectaComponent).nullish(),
  evidence: z.array(TrifectaEvidence).nullish(),
});
export type Finding = z.infer<typeof Finding>;

/** Review — the consolidated structured output of a single agent run. */
export const Review = z.object({
  verdict: Verdict,
  summary: z.string(),
  score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      'Overall PR quality from 0 to 100, where HIGHER is better. 90–100 = no or only trivial issues (approve); 60–89 = minor suggestions; 30–59 = warnings worth addressing; 0–29 = critical problems. Must be consistent with `findings`: if there are no findings, the score is 90 or above.',
    ),
  findings: z.array(Finding),
});
export type Review = z.infer<typeof Review>;

/** Action taken on a finding (accept/dismiss/learn/reply). */
export const FindingActionKind = z.enum(['accept', 'dismiss', 'learn', 'reply']);
export type FindingActionKind = z.infer<typeof FindingActionKind>;

export const FindingAction = z.object({
  action: FindingActionKind,
  reply: z.string().optional(),
});
export type FindingAction = z.infer<typeof FindingAction>;

/**
 * GET /runs/:id/findings — query contract (spec 0011). This is also the shape
 * the MCP server's `get_findings` tool consumes through its `DevDigestApi`
 * port, so `severity`/`category`/`limit`/`cursor` are the filters that resolve
 * in SQL (`modules/reviews/repository/review.repo.ts`), never a JS post-filter.
 *
 * `severity`/`category` accept either one value or several: Fastify's default
 * querystring parser returns a bare string for `?severity=CRITICAL` and an
 * array only once the key repeats (`?severity=CRITICAL&severity=WARNING`), so
 * both forms are normalized to an array here.
 *
 * `limit`/`cursor` mirror `modules/_shared/schemas.ts` `PageQuery`: an opaque
 * cursor, passed back unchanged as `next_cursor`. The default is lower (20 vs
 * 100) and so is the cap is unchanged (200) — findings pages feed an LLM tool
 * result, where the response itself, not the round-trip count, is the budget.
 */
const toArray = <Item>(value: Item | Item[]): Item[] => (Array.isArray(value) ? value : [value]);

export const RunFindingsQuery = z.object({
  severity: z
    .union([Severity, z.array(Severity)])
    .transform(toArray)
    .optional(),
  category: z
    .union([FindingCategory, z.array(FindingCategory)])
    .transform(toArray)
    .optional(),
  limit: z.coerce.number().int().positive().max(200).default(20),
  cursor: z.string().min(1).optional(),
});
export type RunFindingsQuery = z.infer<typeof RunFindingsQuery>;

/**
 * One page of a run's findings, plus the run's own status — so a caller
 * polling a still-running run (which has no findings yet: they are persisted
 * only when the run completes) needs one call, not a findings fetch AND a
 * separate run-status fetch.
 */
export const RunFindingsPage = z.object({
  findings: z.array(
    Finding.extend({
      review_id: z.string(),
      accepted_at: z.string().nullable(),
      dismissed_at: z.string().nullable(),
    }),
  ),
  // running | done | failed | cancelled | null (unknown run — the route 404s
  // instead, but the field stays nullable for the same reason RunSummary's does).
  status: z.string().nullable(),
  // The run's citation-grounding tally, e.g. "3/4 passed" — "0/0 passed" when
  // the agent had no diff to review. Without it, `findings: []` on a `done` run
  // is ambiguous: a clean review and a review of nothing look identical, and a
  // caller reports "no issues found" either way.
  grounding: z.string().nullable(),
  next_cursor: z.string().nullable(),
});
export type RunFindingsPage = z.infer<typeof RunFindingsPage>;
