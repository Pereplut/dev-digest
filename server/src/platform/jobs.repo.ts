import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import * as t from '../db/schema.js';

/**
 * jobs data-access layer — the ONLY file behind JobRunner that touches Drizzle.
 * `platform/jobs.ts` is an application service (onion ring 3) and orchestrates
 * the queue; every read/write of the `jobs` table lives here.
 */
export class JobsRepository {
  constructor(private db: Db) {}

  async insertQueued(workspaceId: string, kind: string, payload: unknown): Promise<string> {
    const [row] = await this.db
      .insert(t.jobs)
      .values({ workspaceId, kind, payload: payload as object, status: 'queued' })
      .returning({ id: t.jobs.id });
    return row!.id;
  }

  async markRunning(jobId: string): Promise<void> {
    await this.db
      .update(t.jobs)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(t.jobs.id, jobId));
  }

  async setAttempts(jobId: string, attempts: number): Promise<void> {
    await this.db.update(t.jobs).set({ attempts }).where(eq(t.jobs.id, jobId));
  }

  async markDone(jobId: string): Promise<void> {
    await this.db
      .update(t.jobs)
      .set({ status: 'done', finishedAt: new Date() })
      .where(eq(t.jobs.id, jobId));
  }

  /** `error` must already be redacted — this layer stores what it is given. */
  async markFailed(jobId: string, error: string): Promise<void> {
    await this.db
      .update(t.jobs)
      .set({ status: 'failed', finishedAt: new Date(), error })
      .where(eq(t.jobs.id, jobId));
  }

  /** Fail every `queued`/`running` row; returns how many were touched. */
  async failUnfinished(error: string): Promise<number> {
    const rows = await this.db
      .update(t.jobs)
      .set({ status: 'failed', finishedAt: new Date(), error })
      .where(inArray(t.jobs.status, ['queued', 'running']))
      .returning({ id: t.jobs.id });
    return rows.length;
  }
}
