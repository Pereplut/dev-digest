import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { ConventionRow, ConventionScanRow } from '../../../db/rows.js';
import type { ConventionCategory, ConventionStatus } from '@devdigest/shared';
import { redactCredentials } from '../../../platform/redact.js';
import { dedupeByFingerprint } from '../helpers.js';

export type { ConventionRow, ConventionScanRow };

/** A proved (or disproved) candidate, ready to be merged into the table. */
export interface ConventionUpsert {
  workspaceId: string;
  repoId: string;
  scanId: string;
  category: ConventionCategory;
  rule: string;
  evidencePath: string;
  evidenceStartLine: number | null;
  evidenceEndLine: number | null;
  evidenceSnippet: string;
  confidence: number;
  evidenceValid: boolean;
  rejectedReason: string | null;
  fingerprint: string;
}

export interface ScanCounts {
  sampler: 'repo-intel' | 'walk';
  sampleFileCount: number;
  candidateCount: number;
  rejectedCount: number;
  model: string | null;
  costUsd: number | null;
}

/**
 * Conventions data-access (spec 0007). Owns `conventions` and
 * `convention_scans`. Workspace-scoped on every read and write.
 */
/** The repo facts the extractor needs. Mirrors repo-intel's `getRepoBasics`. */
export interface ConventionRepoBasics {
  id: string;
  fullName: string;
  clonePath: string | null;
}

export class ConventionsRepository {
  constructor(private db: DbOrTx) {}

  /**
   * Repo basics, read here rather than through RepoRepository: a module must
   * not import another module's repository (`no-cross-module-internals`), and
   * repo-intel sets the precedent of owning this small read.
   */
  async getRepoBasics(
    workspaceId: string,
    repoId: string,
  ): Promise<ConventionRepoBasics | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        fullName: t.repos.fullName,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)))
      .limit(1);
    return row;
  }

  // ---------------------------------------------------------------- candidates

  listForRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.confidence), desc(t.conventions.createdAt));
  }

  async get(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .limit(1);
    return row;
  }

  async listByIds(workspaceId: string, ids: string[]): Promise<ConventionRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), inArray(t.conventions.id, ids)))
      .orderBy(desc(t.conventions.confidence));
  }

  /**
   * Merge a scan's results into the table.
   *
   * ON CONFLICT (repo_id, fingerprint) refreshes the evidence and the scan link
   * but deliberately LEAVES `status` alone, so an accept or reject the user made
   * earlier survives a re-scan. A candidate that fails proof this time is forced
   * back to `rejected`, because its evidence no longer holds.
   */
  async mergeCandidates(input: ConventionUpsert[]): Promise<void> {
    // Defensive: a single statement may not touch the same conflict target
    // twice (SQLSTATE 21000 aborts the batch). The service already dedupes for
    // its counts; doing it here too makes the invariant hold for any caller.
    const rows = dedupeByFingerprint(input);
    if (rows.length === 0) return;
    await this.db
      .insert(t.conventions)
      .values(
        rows.map((r) => ({
          workspaceId: r.workspaceId,
          repoId: r.repoId,
          scanId: r.scanId,
          category: r.category,
          rule: r.rule,
          evidencePath: r.evidencePath,
          evidenceStartLine: r.evidenceStartLine,
          evidenceEndLine: r.evidenceEndLine,
          evidenceSnippet: r.evidenceSnippet,
          confidence: r.confidence,
          status: (r.evidenceValid ? 'pending' : 'rejected') as ConventionStatus,
          evidenceValid: r.evidenceValid,
          rejectedReason: r.rejectedReason,
          fingerprint: r.fingerprint,
        })),
      )
      .onConflictDoUpdate({
        target: [t.conventions.repoId, t.conventions.fingerprint],
        set: {
          scanId: sql`excluded.scan_id`,
          category: sql`excluded.category`,
          evidenceStartLine: sql`excluded.evidence_start_line`,
          evidenceEndLine: sql`excluded.evidence_end_line`,
          evidenceSnippet: sql`excluded.evidence_snippet`,
          confidence: sql`excluded.confidence`,
          evidenceValid: sql`excluded.evidence_valid`,
          rejectedReason: sql`excluded.rejected_reason`,
          /**
           * Keep the USER's decision; retract the MACHINE's.
           *
           * `rejected_reason` is what tells them apart: proof failures set it,
           * a person rejecting a candidate in the UI never does. Without the
           * middle branch a candidate auto-rejected by one scan stayed rejected
           * for ever, because the first branch preserved the stored status once
           * its evidence became valid again.
           */
          status: sql`
            case
              when not excluded.evidence_valid then 'rejected'
              when ${t.conventions.rejectedReason} is not null then 'pending'
              else ${t.conventions.status}
            end
          `,
          updatedAt: sql`now()`,
        },
      });
  }

  async patch(
    workspaceId: string,
    id: string,
    patch: { status?: ConventionStatus; rule?: string; category?: ConventionCategory },
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        /**
         * Setting a status by hand also clears the MACHINE's marker.
         *
         * `mergeCandidates` reads a non-null `rejected_reason` as "this row was
         * auto-rejected", and resets such a row to `pending` once its evidence
         * proves valid again. Leaving the marker in place after a person has
         * decided would make the next scan overwrite THEIR choice — the exact
         * thing the fingerprint merge exists to protect.
         */
        ...(patch.status !== undefined ? { status: patch.status, rejectedReason: null } : {}),
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  // --------------------------------------------------------------------- scans

  async startScan(workspaceId: string, repoId: string): Promise<ConventionScanRow> {
    const [row] = await this.db
      .insert(t.conventionScans)
      .values({ workspaceId, repoId, status: 'running' })
      .returning();
    return row!;
  }

  async finishScan(scanId: string, counts: ScanCounts): Promise<void> {
    await this.db
      .update(t.conventionScans)
      .set({
        status: 'done',
        sampler: counts.sampler,
        sampleFileCount: counts.sampleFileCount,
        candidateCount: counts.candidateCount,
        rejectedCount: counts.rejectedCount,
        model: counts.model,
        // numeric ⇒ string on Drizzle 0.38.
        costUsd: counts.costUsd === null ? null : String(counts.costUsd),
        finishedAt: new Date(),
      })
      .where(eq(t.conventionScans.id, scanId));
  }

  /**
   * The error text is stored for the UI, so it is redacted HERE rather than at
   * the call site — the same chokepoint rule `platform/jobs.ts` follows when it
   * writes a failed job. A clone URL carries a PAT, git echoes the full remote
   * in its stderr, and any error raised below this row would otherwise persist
   * that token in cleartext and serve it to the browser.
   */
  async failScan(scanId: string, error: string): Promise<void> {
    await this.db
      .update(t.conventionScans)
      .set({ status: 'failed', error: redactCredentials(error), finishedAt: new Date() })
      .where(eq(t.conventionScans.id, scanId));
  }

  async latestScan(workspaceId: string, repoId: string): Promise<ConventionScanRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionScans)
      .where(
        and(eq(t.conventionScans.workspaceId, workspaceId), eq(t.conventionScans.repoId, repoId)),
      )
      .orderBy(desc(t.conventionScans.startedAt))
      .limit(1);
    return row;
  }
}
