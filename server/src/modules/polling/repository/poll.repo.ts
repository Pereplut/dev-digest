import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';

/**
 * polling data-access layer — the ONLY place in this module that touches
 * Drizzle.
 *
 * The PR upsert here is deliberately NOT shared with `pulls`: the two write
 * subtly different column sets (this one never sets `opened_at`), and
 * importing another module's data layer is what `no-cross-module-internals`
 * forbids. Unifying them is a behaviour decision, not a refactor — see the
 * note in service.ts.
 */

export type RepoRow = typeof t.repos.$inferSelect;

/** Columns written for one PR synced by a manual poll (built in helpers.ts). */
export interface PollUpsertValues {
  workspaceId: string;
  repoId: string;
  number: number;
  title: string;
  author: string;
  branch: string;
  base: string;
  headSha: string;
  additions: number;
  deletions: number;
  filesCount: number;
  status: string;
  updatedAt: Date | null;
}

export class PollingRepository {
  constructor(private db: Db) {}

  async getRepo(workspaceId: string, repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /** Idempotent import (unique repo_id+number); only moving fields are updated. */
  async upsertPull(values: PollUpsertValues): Promise<void> {
    await this.db
      .insert(t.pullRequests)
      .values(values)
      .onConflictDoUpdate({
        target: [t.pullRequests.repoId, t.pullRequests.number],
        set: {
          title: values.title,
          headSha: values.headSha,
          status: values.status,
          updatedAt: values.updatedAt,
        },
      });
  }

  async touchLastPolled(repoId: string): Promise<void> {
    await this.db
      .update(t.repos)
      .set({ lastPolledAt: new Date() })
      .where(eq(t.repos.id, repoId));
  }
}
