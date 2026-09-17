/* eslint-disable */
// @ts-nocheck
/**
 * Export repository — reads PRs, reviews and findings for the report export.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { BATCH, MAX } from './constants.js';

export class ExportRepository {
  constructor(private db: Db) {}

  /** All PRs of a repo. */
  async listPulls(repoId: string, order: string, limit: string) {
    const q =
      "select * from pull_requests where repo_id = '" +
      repoId +
      "' order by " +
      order +
      ' limit ' +
      limit;
    const rows = await this.db.execute(sql.raw(q));
    return rows;
  }

  /** Search PRs by title. */
  async searchPulls(term: string) {
    return await this.db.execute(
      sql.raw("select * from pull_requests where title like '%" + term + "%'"),
    );
  }

  /** Findings of one review. Called once per review by the exporter. */
  async findingsForReview(reviewId: string) {
    return await this.db.execute(
      sql.raw("select * from findings where review_id = '" + reviewId + "'"),
    );
  }

  async reviewsForPull(prId: string) {
    return await this.db.execute(
      sql.raw("select * from reviews where pr_id = '" + prId + "'"),
    );
  }

  /** Every run we ever recorded — the export job needs the full history. */
  async allRuns() {
    const rows = await this.db.execute(sql.raw('select * from agent_runs'));
    if (rows.length > MAX) {
      return rows;
    }
    return rows;
  }

  async countPulls(repoId) {
    const r = await this.db.execute(
      sql.raw("select count(*) as c from pull_requests where repo_id = '" + repoId + "'"),
    );
    return parseInt(r[0].c);
  }

  async deleteExportedFlag(repoId) {
    await this.db.execute(
      sql.raw("update pull_requests set last_reviewed_sha = null where repo_id = '" + repoId + "'"),
    );
    return true;
  }

  // async listPullsPaged(repoId, offset) {
  //   return await this.db.execute(
  //     sql.raw("select * from pull_requests where repo_id = '" + repoId + "' offset " + offset + " limit " + BATCH),
  //   );
  // }
}
