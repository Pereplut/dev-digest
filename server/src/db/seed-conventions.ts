/**
 * Seeded convention candidates for the demo repo (spec 0007).
 *
 * IMPORTANT — why these are seeded as already-proved (`evidenceValid: true`):
 * `acme/payments-api` is a FICTIONAL repo with `clonePath: null`, so there is no
 * checkout on disk for the proof step to read. A real extraction against it
 * returns 409 ("no local checkout"). These rows exist so the Conventions page is
 * demoable and e2e-testable without a clone or a model call; they are NOT the
 * output of a real validation run. Extract against an imported repo to see the
 * proof step actually reject anything.
 *
 * Fingerprints are computed with the same function the extractor uses, so a
 * later real scan of the same repo merges into these rows instead of duplicating
 * them.
 */
import type { ConventionCategory } from '@devdigest/shared';

export interface SeedConvention {
  category: ConventionCategory;
  rule: string;
  evidencePath: string;
  evidenceStartLine: number;
  evidenceEndLine: number;
  evidenceSnippet: string;
  confidence: number;
}

export const SEED_CONVENTIONS: SeedConvention[] = [
  {
    category: 'async',
    rule: 'Always use async/await instead of .then() chains',
    evidencePath: 'src/api/users.ts',
    evidenceStartLine: 23,
    evidenceEndLine: 31,
    evidenceSnippet: [
      'const user = await db.users.find(id);',
      'const posts = await db.posts.findMany({ userId });',
    ].join('\n'),
    confidence: 0.91,
  },
  {
    category: 'api',
    rule: 'All public route handlers return typed Result<T, ApiError>',
    evidencePath: 'src/api/public/index.ts',
    evidenceStartLine: 14,
    evidenceEndLine: 20,
    evidenceSnippet: [
      'function handler(): Result<Item[], ApiError> {',
      '  return ok(items);',
      '}',
    ].join('\n'),
    confidence: 0.78,
  },
  {
    category: 'structure',
    rule: 'Redis access goes through the src/lib/redis.ts singleton',
    evidencePath: 'src/lib/redis.ts',
    evidenceStartLine: 1,
    evidenceEndLine: 9,
    evidenceSnippet: 'export const redis = new Redis(config.redisUrl);',
    confidence: 0.85,
  },
];
