import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { EvalCaseRow } from '../../../db/rows.js';
import { ConflictError } from '../../../platform/errors.js';

export type { EvalCaseRow };

/**
 * `eval_cases` data-access (spec 0019). The only file here allowed to import
 * drizzle-orm, matching `eval-batch.repo.ts`.
 */

/** Postgres unique_violation, possibly wrapped by the driver/ORM. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

export interface InsertEvalCaseFromFinding {
  workspaceId: string;
  ownerKind: 'agent' | 'skill';
  ownerId: string;
  name: string;
  inputDiff: string;
  notes?: string | null;
  expectationKind: 'must_find' | 'must_not_flag';
  expectedFile: string;
  expectedStartLine: number;
  expectedEndLine: number;
  sourceFindingId: string;
}

export interface EvalCasePatchValues {
  name?: string;
  notes?: string | null;
  expectationKind?: 'must_find' | 'must_not_flag';
  expectedFile?: string;
  expectedStartLine?: number;
  expectedEndLine?: number;
}

export class EvalCaseRepository {
  constructor(private db: DbOrTx) {}

  /**
   * Insert a case born from a finding. Throws `ConflictError` on a duplicate
   * `(owner_id, source_finding_id)` — the partial unique index is the backstop
   * for a double-click or a reload defeating the client's session-scoped
   * disable (AC-67).
   */
  async insertFromFinding(values: InsertEvalCaseFromFinding): Promise<EvalCaseRow> {
    try {
      const [row] = await this.db
        .insert(t.evalCases)
        .values({
          workspaceId: values.workspaceId,
          ownerKind: values.ownerKind,
          ownerId: values.ownerId,
          name: values.name,
          inputDiff: values.inputDiff,
          notes: values.notes ?? null,
          expectationKind: values.expectationKind,
          expectedFile: values.expectedFile,
          expectedStartLine: values.expectedStartLine,
          expectedEndLine: values.expectedEndLine,
          sourceFindingId: values.sourceFindingId,
        })
        .returning();
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError('An eval case for this finding already exists', {
          field: 'source_finding_id',
        });
      }
      throw err;
    }
  }

  /** An owner's cases, scoped to the workspace — newest first, id ascending for ties (AC-27). */
  async listForAgent(workspaceId: string, ownerId: string): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerId, ownerId)))
      .orderBy(desc(t.evalCases.createdAt), asc(t.evalCases.id));
  }

  /** One case, scoped to the workspace — `undefined` if unknown or another workspace's (AC-30). */
  async getScoped(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  /** Persist only the supplied fields (AC-28). */
  async patch(
    workspaceId: string,
    id: string,
    patch: EvalCasePatchValues,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.expectationKind !== undefined ? { expectationKind: patch.expectationKind } : {}),
        ...(patch.expectedFile !== undefined ? { expectedFile: patch.expectedFile } : {}),
        ...(patch.expectedStartLine !== undefined ? { expectedStartLine: patch.expectedStartLine } : {}),
        ...(patch.expectedEndLine !== undefined ? { expectedEndLine: patch.expectedEndLine } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row;
  }

  /** Delete a case, scoped to the workspace. Its `eval_runs` rows cascade (AC-29). */
  async remove(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  /** How many cases an owner has — zero means a run has nothing to sweep (AC-33). */
  async countForAgent(workspaceId: string, ownerId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.ownerId, ownerId)));
    return row?.n ?? 0;
  }
}
