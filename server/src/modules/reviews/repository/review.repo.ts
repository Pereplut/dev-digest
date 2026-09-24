import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { DbOrTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Finding } from '@devdigest/shared';
import type { FindingRow, PullRow } from '../../../db/rows.js';

export type ReviewRow = typeof t.reviews.$inferSelect;

// Every function takes `DbOrTx` so a caller can compose several of them into a
// single transaction (see ReviewRepository.transaction). Passing the pool keeps
// the previous auto-commit behaviour.

// ---- reviews + findings ---------------------------------------------------

export async function insertReview(
  db: DbOrTx,
  values: {
    workspaceId: string;
    prId: string;
    agentId: string | null;
    runId: string | null;
    kind: 'summary' | 'review';
    verdict: string | null;
    summary: string | null;
    score: number | null;
    model: string | null;
  },
): Promise<ReviewRow> {
  const [row] = await db.insert(t.reviews).values(values).returning();
  return row!;
}

export async function insertFindings(
  db: DbOrTx,
  reviewId: string,
  findings: Finding[],
): Promise<FindingRow[]> {
  if (findings.length === 0) return [];
  const rows = await db
    .insert(t.findings)
    .values(
      findings.map((f) => ({
        reviewId,
        file: f.file,
        startLine: f.start_line,
        endLine: f.end_line,
        severity: f.severity,
        category: f.category,
        title: f.title,
        rationale: f.rationale,
        suggestion: f.suggestion ?? null,
        confidence: f.confidence,
        kind: f.kind ?? 'finding',
        trifectaComponents: f.trifecta_components ?? null,
      })),
    )
    .returning();
  return rows;
}

/** Reviews for a PR (newest first), each with its findings. */
export async function reviewsForPull(
  db: DbOrTx,
  prId: string,
): Promise<{ review: ReviewRow; findings: FindingRow[] }[]> {
  const reviews = await db
    .select()
    .from(t.reviews)
    .where(eq(t.reviews.prId, prId))
    .orderBy(desc(t.reviews.createdAt));
  if (reviews.length === 0) return [];
  const ids = reviews.map((r) => r.id);
  const findings = await db.select().from(t.findings).where(inArray(t.findings.reviewId, ids));
  return reviews.map((review) => ({
    review,
    findings: findings.filter((f) => f.reviewId === review.id),
  }));
}

/**
 * Open findings of the PR's LATEST review, as `file` + `start_line` only — what
 * Smart Diff needs to mark which files carry findings.
 *
 * "Latest" is the same rule the PR list uses (`pulls/repository/pull.repo.ts`
 * `latestReviewedRunByPr`): the newest run that is `done` AND actually carries a
 * `kind='review'` review, so a newer failed or review-less run cannot hide it.
 * Re-deriving that in JS from `reviewsForPull` would fork the definition, which
 * is why this lives here. Open = `dismissed_at IS NULL`.
 */
export async function latestReviewFindings(
  db: DbOrTx,
  workspaceId: string,
  prId: string,
): Promise<{ file: string; startLine: number }[]> {
  // One PR, so `.limit(1)` — NOT the `selectDistinctOn` of `latestReviewedRunByPr`,
  // which only earns its keep there because it batches many PRs at once.
  const latest = db
    .select({ id: t.reviews.id })
    .from(t.reviews)
    .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.reviews.runId))
    .where(
      and(
        eq(t.reviews.workspaceId, workspaceId),
        eq(t.reviews.prId, prId),
        eq(t.reviews.kind, 'review'),
        eq(t.agentRuns.status, 'done'),
      ),
    )
    .orderBy(desc(t.agentRuns.ranAt), desc(t.reviews.createdAt))
    .limit(1);

  // As a subquery, not a second round trip: one statement is one snapshot, so a
  // run finishing mid-read cannot pair a stale review id with current findings.
  // An empty subquery matches nothing, which is the "no review yet" case.
  return db
    .select({ file: t.findings.file, startLine: t.findings.startLine })
    .from(t.findings)
    .where(and(inArray(t.findings.reviewId, latest), isNull(t.findings.dismissedAt)));
}

export async function getReview(db: DbOrTx, reviewId: string): Promise<ReviewRow | undefined> {
  const [row] = await db.select().from(t.reviews).where(eq(t.reviews.id, reviewId));
  return row;
}

/** Delete a whole review (one agent's run) + its findings (cascade), scoped
 *  to the workspace. Returns false if not found in the workspace. */
export async function deleteReview(
  db: DbOrTx,
  workspaceId: string,
  reviewId: string,
): Promise<boolean> {
  const rows = await db
    .delete(t.reviews)
    .where(and(eq(t.reviews.workspaceId, workspaceId), eq(t.reviews.id, reviewId)))
    .returning({ id: t.reviews.id });
  return rows.length > 0;
}

// ---- finding actions ------------------------------------------------------

export async function getFinding(db: DbOrTx, findingId: string): Promise<FindingRow | undefined> {
  const [row] = await db.select().from(t.findings).where(eq(t.findings.id, findingId));
  return row;
}

/** Resolve workspace_id + pr_id for a finding (via review → pr). */
export async function findingContext(
  db: DbOrTx,
  findingId: string,
): Promise<{ finding: FindingRow; review: ReviewRow; pull: PullRow } | undefined> {
  const finding = await getFinding(db, findingId);
  if (!finding) return undefined;
  const review = await getReview(db, finding.reviewId);
  if (!review) return undefined;
  const [pull] = await db
    .select()
    .from(t.pullRequests)
    .where(eq(t.pullRequests.id, review.prId));
  if (!pull) return undefined;
  return { finding, review, pull };
}

export async function setFindingAccepted(
  db: DbOrTx,
  findingId: string,
  at: Date | null,
): Promise<FindingRow | undefined> {
  const [row] = await db
    .update(t.findings)
    .set({ acceptedAt: at, dismissedAt: null })
    .where(eq(t.findings.id, findingId))
    .returning();
  return row;
}

export async function setFindingDismissed(
  db: DbOrTx,
  findingId: string,
  at: Date | null,
): Promise<FindingRow | undefined> {
  const [row] = await db
    .update(t.findings)
    .set({ dismissedAt: at, acceptedAt: null })
    .where(eq(t.findings.id, findingId))
    .returning();
  return row;
}
