import { eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';

/**
 * workspace data-access layer — the ONLY place in this module that touches
 * Drizzle. One read: the repos belonging to a workspace.
 */

export type RepoRow = typeof t.repos.$inferSelect;

export class WorkspaceRepository {
  constructor(private db: Db) {}

  async listRepos(workspaceId: string): Promise<RepoRow[]> {
    return this.db.select().from(t.repos).where(eq(t.repos.workspaceId, workspaceId));
  }
}
