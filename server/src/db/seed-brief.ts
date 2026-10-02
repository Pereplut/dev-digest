import type { PrBriefEnvelope } from '@devdigest/shared';

/**
 * Seeded `pr_brief` envelope for PR #482 (spec 0018).
 *
 * Hand-authored, not generated: no model call runs at seed time (the
 * generation path is covered by server tests, not the seed or e2e — see
 * `specs/0018-pr-brief.md` Decisions, "e2e seeds, never generates"). Every
 * grounded path below is drawn only from the four `pr_files` rows this seed
 * already inserts for PR #482 (`seed.ts`, "PR #482 (rate limiting)"), and
 * `head_sha` matches the seeded PR's own `head_sha` exactly, so the Overview
 * tab renders `stale: false` with no out-of-date hint.
 *
 * `missing_inputs` carries only `blast` — the state this repo truly produces
 * (`clone_path` is `null` for the seeded repo and no index row exists, so a
 * real `GET /pulls/:id/brief` would report the same `{input:'blast',
 * reason:'no_data'}`). No `pr_intent` row is seeded either, but this is
 * static fixture data (not a service-generated envelope), so it carries a
 * plausible `intent` rather than the placeholder a real no-intent generation
 * would store — nothing renders this field (`AC-59`), so its exact content
 * is provenance only.
 */
export const SEED_PR_BRIEF_ENVELOPE: PrBriefEnvelope = {
  intent: {
    intent: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
    in_scope: ['src/middleware/ratelimit.ts', 'src/api/public/webhooks.ts'],
    out_of_scope: [],
  },
  blast: {
    changed_symbols: [],
    downstream: [],
    summary: '0 symbols · 0 callers · 0 endpoints · 0 crons',
    degraded: true,
    reason: 'no_data',
  },
  risks: {
    risks: [
      {
        kind: 'security',
        title: 'Rate limiter state is kept in memory only',
        explanation:
          'The token-bucket limiter keeps its counters in process memory, so a multi-instance deployment ' +
          'lets each instance enforce its own independent limit rather than a shared one.',
        severity: 'medium',
        file_refs: ['src/middleware/ratelimit.ts'],
      },
      {
        kind: 'correctness',
        title: 'Webhook endpoint now shares the public rate limit',
        explanation:
          'The public webhook handler is wrapped by the same limiter configuration as regular API traffic, ' +
          'which may throttle a legitimate high-volume webhook sender.',
        severity: 'low',
        file_refs: ['src/api/public/webhooks.ts'],
      },
    ],
  },
  history: { history: [] },
  summary:
    'Adds a token-bucket rate limiter and applies it to the public API and webhook endpoints to block abuse ' +
    'from unauthenticated clients. The limiter itself is new; the main review surface is how it is wired into ' +
    'existing handlers.',
  review_focus: [
    {
      file: 'src/middleware/ratelimit.ts',
      line: 1,
      reason: 'New token-bucket limiter — read this first to understand the throttling strategy.',
    },
    {
      file: 'src/api/public/webhooks.ts',
      line: 1,
      reason: 'Webhook handler now wrapped by the limiter; check it does not throttle legitimate callers.',
    },
    {
      file: 'src/config.ts',
      line: 1,
      reason: 'New config values the limiter reads — confirm defaults are sane for production traffic.',
    },
  ],
  head_sha: 'a1b2c3d4e5f6',
  generated_at: '2026-09-20T09:00:00.000Z',
  model: 'seed',
  missing_inputs: [{ input: 'blast', reason: 'no_data' }],
};
