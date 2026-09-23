import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Intent, PrIntentRecord } from '@devdigest/shared';
import { IntentCategory, IntentConfidence } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';
import type { IntentEvidenceRow, IntentSourceRow } from '../../../db/schema/reviews.js';

// Every function takes `DbOrTx` so a caller can compose several of them into a
// single transaction (see ReviewRepository.transaction). Passing the pool keeps
// the previous auto-commit behaviour.

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: DbOrTx,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: DbOrTx,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: DbOrTx,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: DbOrTx, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

/**
 * Everything the intent step persists (spec 0008). One row per PR: the
 * classification is derived once per PR version and shared by every agent in a
 * run, so this is an upsert on `pr_id`, not an append.
 */
export interface IntentUpsert {
  intent: Intent;
  category: IntentCategory;
  /** Server-computed band. The model is never asked for a number (decision D1). */
  confidence: IntentConfidence;
  rationale: string | null;
  sources: IntentSourceRow[];
  evidence: IntentEvidenceRow[];
  inputHash: string | null;
  headSha: string | null;
  provider: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
}

export async function upsertIntent(db: DbOrTx, prId: string, row: IntentUpsert): Promise<void> {
  const values = {
    prId,
    intent: row.intent.intent,
    inScope: row.intent.in_scope,
    outOfScope: row.intent.out_of_scope,
    category: row.category,
    confidence: row.confidence,
    rationale: row.rationale,
    sources: row.sources,
    evidence: row.evidence,
    inputHash: row.inputHash,
    headSha: row.headSha,
    provider: row.provider,
    model: row.model,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    // `numeric` round-trips as a string in pg; the conversion belongs at this
    // boundary so nothing above the repository handles the driver's shape.
    costUsd: row.costUsd === null ? null : String(row.costUsd),
    derivedAt: new Date(),
  };
  await db
    .insert(t.prIntent)
    .values(values)
    .onConflictDoUpdate({ target: t.prIntent.prId, set: values });
}

/**
 * The stored intent, or undefined when none was ever derived.
 *
 * Returns the full record rather than the bare `Intent`, because both callers
 * need more than the sentence: the run needs `inputHash` to decide whether it
 * can skip the model, and the API needs the sources and evidence to show how
 * much the classification is worth.
 */
export async function getIntent(db: DbOrTx, prId: string): Promise<PrIntentRecord | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return {
    pr_id: row.prId,
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    category: IntentCategory.catch('unknown').parse(row.category),
    confidence: IntentConfidence.catch('low').parse(row.confidence),
    rationale: row.rationale,
    sources: row.sources.map((s) => ({
      kind: s.kind,
      ref: s.ref,
      chars: s.chars,
      truncated: s.truncated,
      status: s.status,
    })),
    evidence: row.evidence.map((e) => ({
      source_kind: e.sourceKind,
      ref: e.ref,
      quote: e.quote,
      valid: e.valid,
    })),
    head_sha: row.headSha,
    model: row.model,
    cost_usd: row.costUsd === null ? null : Number(row.costUsd),
    derived_at: row.derivedAt.toISOString(),
  };
}

/** The input hash of the stored intent, for the reuse check. Cheaper than the full row. */
/**
 * Commit subject lines for the classifier, oldest first, capped.
 *
 * Only the first line of each message: the subject is the author saying what
 * the commit is for, and the body is usually the same detail the PR
 * description already carries.
 *
 * May legitimately return nothing. `pr_commits` is DELETEd and re-inserted on
 * every PR-detail load (`modules/pulls/repository/pull.repo.ts`), so a PR that
 * has not been opened has no rows here. The intent layer treats the source as
 * absent, which is the same as any other source it did not get.
 */
export async function listCommitSubjects(
  db: DbOrTx,
  prId: string,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ message: t.prCommits.message })
    .from(t.prCommits)
    .where(eq(t.prCommits.prId, prId))
    .limit(limit);
  return rows.map((r) => r.message.split('\n')[0]?.trim() ?? '').filter((s) => s.length > 0);
}

export async function getIntentInputHash(db: DbOrTx, prId: string): Promise<string | null> {
  const [row] = await db
    .select({ inputHash: t.prIntent.inputHash })
    .from(t.prIntent)
    .where(eq(t.prIntent.prId, prId));
  return row?.inputHash ?? null;
}
