/**
 * Onboarding data access — the only drizzle in this feature (spec 0017).
 *
 * `claimGeneration` is the single INSERT (invariant I1): it is what makes a
 * repository deleted mid-generation safe — every other method is an UPDATE
 * guarded by `generation_id = $g AND status = 'running'` (invariant I3), so a
 * cascade-deleted row simply makes that UPDATE affect zero rows rather than
 * throwing `23503`. Every write that leaves `status <> 'running'` clears
 * `started_at`, `job_id` AND `generation_id` together (invariant I4).
 *
 * This module also owns the two cross-module reads `first_tasks` needs
 * (`findings`/`reviews`/`pull_requests`, and `conventions`) — querying a
 * shared schema table is legal for `drizzle-only-in-repositories`; importing
 * another module's service or repository is not, and this does neither
 * (plan decision 7, P1 declined).
 */
import { and, desc, eq, isNull, isNotNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { OnboardingSection, type OnboardingStatus } from '@devdigest/shared';
import type { DbOrTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { OnboardingRow } from '../../../db/rows.js';
import { GENERATION_STALE_MS } from '../constants.js';

export type { OnboardingRow };

/** `json.sections`, parsed — the DTO mapper's single source of truth (invariant I2). */
const StoredTourJson = z.object({ sections: z.array(OnboardingSection) }).partial();

export interface StoredTour {
  sections: OnboardingSection[] | null;
  generatedAt: string | null;
}

/**
 * `generated_at`'s wire value is null until `json.sections` exists, even
 * though the column itself is `defaultNow().notNull()` — the claim's INSERT
 * stamps a timestamp that is a storage artifact, not a generation time.
 */
export function toStoredTour(row: OnboardingRow): StoredTour {
  const parsed = StoredTourJson.safeParse(row.json);
  const sections = parsed.success ? (parsed.data.sections ?? null) : null;
  return { sections, generatedAt: sections ? row.generatedAt.toISOString() : null };
}

export interface OpenFindingRow {
  file: string;
  startLine: number;
}

export interface PendingCandidateRow {
  id: string;
  evidencePath: string;
  evidenceStartLine: number | null;
}

/** The repo facts the service needs. Mirrors conventions' own `getRepoBasics` (decision 7). */
export interface OnboardingRepoBasics {
  id: string;
  fullName: string;
  clonePath: string | null;
}

export class OnboardingRepository {
  constructor(private db: DbOrTx) {}

  /**
   * Workspace-scoped repo basics, read HERE rather than through another
   * module's repository — `no-cross-module-internals` bars importing another
   * module's service/repository, not reading the shared `repos` table.
   */
  async getRepoBasics(workspaceId: string, repoId: string): Promise<OnboardingRepoBasics | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, fullName: t.repos.fullName, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)))
      .limit(1);
    return row;
  }

  async getRow(repoId: string): Promise<OnboardingRow | undefined> {
    const [row] = await this.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repoId)).limit(1);
    return row;
  }

  /**
   * Claim first (decision 2): a single conditional upsert that decides AC-20
   * (stale takeover) and AC-21 (exactly one winner) together — the row lock
   * means exactly one concurrent caller gets a row back. The stale interval is
   * computed IN SQL (`now() - interval * $ms`), never bound as a JS `Date`
   * (server/INSIGHTS.md, 2026-09-18: a raw `Date` in a hand-written `sql`
   * template fails in the driver, not in Postgres).
   *
   * Returns the claimed row, or `null` when a fresh `running` generation
   * already holds it (the caller is AC-19's loser).
   */
  async claimGeneration(repoId: string, generationId: string): Promise<OnboardingRow | null> {
    const [row] = await this.db
      .insert(t.onboarding)
      .values({
        repoId,
        // `json` is NOT NULL (context.ts) — the claim writes an empty object
        // for a repo's first-ever generation; the DTO mapper treats an absent
        // `sections` key as "no last good tour" regardless.
        json: {},
        status: 'running',
        startedAt: new Date(),
        generationId,
      })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: {
          status: 'running',
          startedAt: new Date(),
          generationId,
          reason: null,
          jobId: null,
        },
        setWhere: sql`${t.onboarding.status} <> 'running' OR ${t.onboarding.startedAt} < now() - (interval '1 millisecond' * ${GENERATION_STALE_MS})`,
      })
      .returning();
    return row ?? null;
  }

  /** `UPDATE … WHERE generation_id = $g AND status = 'running'` (invariant I3). */
  async setJobId(repoId: string, generationId: string, jobId: string): Promise<void> {
    await this.db
      .update(t.onboarding)
      .set({ jobId })
      .where(
        and(
          eq(t.onboarding.repoId, repoId),
          eq(t.onboarding.generationId, generationId),
          eq(t.onboarding.status, 'running'),
        ),
      );
  }

  /**
   * `reason` only ever holds an `OnboardingReason` value, never a provider
   * message — no second persist path to redact (unlike `conventions.error`).
   * Clears every marker column (invariant I4).
   */
  async markFailed(repoId: string, generationId: string): Promise<void> {
    await this.db
      .update(t.onboarding)
      .set({
        status: 'failed',
        reason: 'generation_failed',
        startedAt: null,
        jobId: null,
        generationId: null,
      })
      .where(
        and(
          eq(t.onboarding.repoId, repoId),
          eq(t.onboarding.generationId, generationId),
          eq(t.onboarding.status, 'running'),
        ),
      );
  }

  /**
   * ONE UPDATE writing `json`, `generated_at`, `status` and clearing every
   * marker column together — `done` with no sections is unreachable by
   * construction, not by a column-set convention (invariant I3's guard also
   * means a generation superseded by a later claim writes nothing here).
   */
  async saveTour(
    repoId: string,
    generationId: string,
    sections: OnboardingSection[],
    status: Extract<OnboardingStatus, 'done' | 'partial'>,
  ): Promise<void> {
    await this.db
      .update(t.onboarding)
      .set({
        json: { sections },
        generatedAt: new Date(),
        status,
        reason: null,
        startedAt: null,
        jobId: null,
        generationId: null,
      })
      .where(
        and(
          eq(t.onboarding.repoId, repoId),
          eq(t.onboarding.generationId, generationId),
          eq(t.onboarding.status, 'running'),
        ),
      );
  }

  /** Boot reap (AC-18): every `running` row, unconditionally. Returns the count. */
  async reapRunning(): Promise<number> {
    const rows = await this.db
      .update(t.onboarding)
      .set({
        status: 'failed',
        reason: 'generation_failed',
        startedAt: null,
        jobId: null,
        generationId: null,
      })
      .where(eq(t.onboarding.status, 'running'))
      .returning({ repoId: t.onboarding.repoId });
    return rows.length;
  }

  /** Open findings for `first_tasks` (AC-38, AC-39): `findings → reviews → pull_requests`. */
  async listOpenFindings(repoId: string, limit: number): Promise<OpenFindingRow[]> {
    return this.db
      .select({ file: t.findings.file, startLine: t.findings.startLine })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.pullRequests, eq(t.reviews.prId, t.pullRequests.id))
      .where(
        and(
          eq(t.pullRequests.repoId, repoId),
          isNull(t.findings.acceptedAt),
          isNull(t.findings.dismissedAt),
        ),
      )
      .orderBy(desc(t.reviews.createdAt))
      .limit(limit);
  }

  /** Pending, evidence-proved convention candidates for `first_tasks` (AC-66). */
  async listPendingValidCandidates(repoId: string, limit: number): Promise<PendingCandidateRow[]> {
    const rows = await this.db
      .select({
        id: t.conventions.id,
        evidencePath: t.conventions.evidencePath,
        evidenceStartLine: t.conventions.evidenceStartLine,
      })
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'pending'),
          eq(t.conventions.evidenceValid, true),
          isNotNull(t.conventions.evidencePath),
        ),
      )
      .orderBy(desc(t.conventions.confidence))
      .limit(limit);
    return rows.map((r) => ({ id: r.id, evidencePath: r.evidencePath as string, evidenceStartLine: r.evidenceStartLine }));
  }
}
