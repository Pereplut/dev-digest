import { and, count, desc, eq, inArray, isNull, sql, sum } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { PullRow } from '../../../db/rows.js';

/**
 * pulls data-access layer — the ONLY place in this module that touches
 * Drizzle. Reads of the pull_requests / pr_files / pr_commits tables, plus the
 * four read-model aggregates the PR list needs.
 *
 * Those aggregates query `reviews`, `agent_runs` and `findings`, which the
 * reviews module also queries. They are re-declared here ON PURPOSE:
 * `no-cross-module-internals` forbids importing another module's repository,
 * so isolation is chosen over sharing. Row *shapes* still come from
 * `db/rows.ts`, which exists exactly so modules need not reach into each other
 * for a type (see server/INSIGHTS.md on the agents helpers/repository cycle).
 *
 * Every id-list method returns an empty map for an empty list rather than
 * issuing `IN ()`.
 */

export type RepoRow = typeof t.repos.$inferSelect;
export type PrFileRow = typeof t.prFiles.$inferSelect;
export type PrCommitRow = typeof t.prCommits.$inferSelect;

/**
 * Decoded page boundary: the last row of the previous page. Declared HERE
 * rather than in helpers.ts because helpers.ts already imports types from this
 * file — defining it there and importing it back would close a
 * helpers <-> repository cycle, which `no-circular` forbids and which
 * `tsPreCompilationDeps` sees even for type-only imports.
 */
export interface PullCursor {
  updatedAt: Date;
  id: string;
}

/** Insert/update values for one PR synced from GitHub (built in helpers.ts). */
export interface UpsertPullValues {
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
  openedAt: Date | null;
  updatedAt: Date | null;
}

/** Total cost of a PR's done runs; `complete` is false when one had no price. */
export interface PrCost {
  total: number | null;
  complete: boolean;
}

/** Pre-grouped open-finding counts, as `status.ts#rollupSeverities` wants them. */
export interface SeverityCount {
  severity: string;
  n: number;
}

export interface PrDiffStats {
  additions: number;
  deletions: number;
  filesCount: number;
}

export interface PrDetailFields extends PrDiffStats {
  body: string | null;
}

export interface InsertPrFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface InsertPrCommit {
  sha: string;
  message: string;
  author: string;
  committedAt: Date | null;
}

export class PullsRepository {
  constructor(private db: Db) {}

  // ---- repos + pulls lookup -----------------------------------------------

  /** The repo, scoped to the workspace (tenancy guard for the list route). */
  async getRepo(workspaceId: string, repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /**
   * The repo owning a PR. Deliberately NOT workspace-scoped: the caller has
   * already resolved the PR under a workspace, and the PR carries the repo id.
   */
  async getRepoById(repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db.select().from(t.repos).where(eq(t.repos.id, repoId));
    return row;
  }

  async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  /**
   * One keyset page of a repo's PRs, newest-updated first.
   *
   * `updated_at` is nullable and a keyset needs a TOTAL order, so the sort key
   * is `coalesce(updated_at, epoch)` with `id` breaking ties. The page boundary
   * uses Postgres row-value comparison — `(key, id) < (key, id)` — which is the
   * idiomatic keyset predicate and lets the composite ORDER BY drive it. The
   * `::uuid` cast is required: the bound parameter is text, and `uuid < text`
   * has no operator.
   *
   * Fetches `limit + 1` rows so "is there another page?" needs no second query.
   */
  async listPageByRepo(
    repoId: string,
    opts: { limit: number; cursor?: PullCursor | undefined },
  ): Promise<{ rows: PullRow[]; hasMore: boolean }> {
    const sortKey = sql`coalesce(${t.pullRequests.updatedAt}, to_timestamp(0))`;
    const where = opts.cursor
      ? and(
          eq(t.pullRequests.repoId, repoId),
          // Both bounds are bound as STRINGS and cast in SQL. A hand-written
          // `sql` fragment has no column context, so a raw Date never reaches
          // the timestamptz mapper that `eq(column, date)` would use and the
          // driver rejects it ("Received an instance of Date"). Still fully
          // parameterised — no sql.raw.
          sql`(${sortKey}, ${t.pullRequests.id}) < (${opts.cursor.updatedAt.toISOString()}::timestamptz, ${opts.cursor.id}::uuid)`,
        )
      : eq(t.pullRequests.repoId, repoId);

    const rows = await this.db
      .select()
      .from(t.pullRequests)
      .where(where)
      .orderBy(desc(sortKey), desc(t.pullRequests.id))
      .limit(opts.limit + 1);

    return { rows: rows.slice(0, opts.limit), hasMore: rows.length > opts.limit };
  }

  /**
   * Resolve a PR by its GitHub number within a repo, in ONE query — the
   * lookup the detail page used to pay for by fetching the whole PR list.
   *
   * Scoped by workspace as well as repo: `(repo_id, number)` is unique, so the
   * workspace predicate is redundant for correctness today, but every other
   * read here is tenancy-scoped and a lookup that only trusts a path param is
   * the shape plan item G1 is about.
   */
  async getPullByNumber(
    workspaceId: string,
    repoId: string,
    number: number,
  ): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.repoId, repoId),
          eq(t.pullRequests.number, number),
        ),
      );
    return row;
  }

  // ---- writes --------------------------------------------------------------

  /**
   * Idempotent import of one PR (unique repo_id+number). Only the fields that
   * actually move on a re-sync are updated — title, head sha, status, updated
   * at — so a re-import never clobbers locally-derived columns.
   */
  async upsertFromGitHub(values: UpsertPullValues): Promise<void> {
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

  async updateDiffStats(prId: string, stats: PrDiffStats): Promise<void> {
    await this.db
      .update(t.pullRequests)
      .set({
        additions: stats.additions,
        deletions: stats.deletions,
        filesCount: stats.filesCount,
      })
      .where(eq(t.pullRequests.id, prId));
  }

  async updateDetailFields(prId: string, fields: PrDetailFields): Promise<void> {
    await this.db
      .update(t.pullRequests)
      .set({
        body: fields.body,
        // Diff stats aren't on GitHub's PR-list payload — backfill them from
        // the detail fetch so the Pull Requests list shows real size/files.
        additions: fields.additions,
        deletions: fields.deletions,
        filesCount: fields.filesCount,
      })
      .where(eq(t.pullRequests.id, prId));
  }

  /** Delete-then-insert. Not transactional, matching the pre-extraction code. */
  async replaceFiles(prId: string, files: InsertPrFile[]): Promise<void> {
    await this.db.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
    if (files.length > 0) {
      await this.db.insert(t.prFiles).values(files.map((f) => ({ prId, ...f })));
    }
  }

  /** Delete-then-insert. Not transactional, matching the pre-extraction code. */
  async replaceCommits(prId: string, commits: InsertPrCommit[]): Promise<void> {
    await this.db.delete(t.prCommits).where(eq(t.prCommits.prId, prId));
    if (commits.length > 0) {
      await this.db.insert(t.prCommits).values(commits.map((c) => ({ prId, ...c })));
    }
  }

  async getFiles(prId: string): Promise<PrFileRow[]> {
    return this.db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
  }

  async getCommits(prId: string): Promise<PrCommitRow[]> {
    return this.db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
  }

  // ---- read-model aggregates for the PR list -------------------------------

  /**
   * Latest review SCORE per PR, for the list's score ring. Computed on read
   * (no FK denorm); rows come back newest-first so the first per PR wins.
   */
  async latestReviewScoreByPr(prIds: string[]): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    if (prIds.length === 0) return out;
    const rows = await this.db
      .select({ prId: t.reviews.prId, score: t.reviews.score })
      .from(t.reviews)
      .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review')))
      .orderBy(desc(t.reviews.createdAt));
    for (const rv of rows) if (!out.has(rv.prId)) out.set(rv.prId, rv.score);
    return out;
  }

  /**
   * COST per PR: the sum over ALL successful (status='done') runs, whatever the
   * agent — a deleted agent's runs still cost money. A done run without a price
   * makes the total a lower bound (`complete: false`).
   */
  async costByPr(workspaceId: string, prIds: string[]): Promise<Map<string, PrCost>> {
    const out = new Map<string, PrCost>();
    if (prIds.length === 0) return out;
    const rows = await this.db
      .select({
        prId: t.agentRuns.prId,
        total: sum(t.agentRuns.costUsd),
        runs: count(),
        priced: count(t.agentRuns.costUsd),
      })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          inArray(t.agentRuns.prId, prIds),
          eq(t.agentRuns.status, 'done'),
        ),
      )
      .groupBy(t.agentRuns.prId);
    for (const row of rows) {
      if (!row.prId) continue;
      // postgres returns numeric sums as strings
      out.set(row.prId, {
        total: row.total == null ? null : Number(row.total),
        complete: row.priced === row.runs,
      });
    }
    return out;
  }

  /**
   * The run whose findings the list shows: the newest done run that HAS a
   * `kind='review'` review, so a newer failed or review-less run doesn't hide
   * it. Returns prId → runId.
   */
  async latestReviewedRunByPr(
    workspaceId: string,
    prIds: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (prIds.length === 0) return out;
    const rows = await this.db
      .selectDistinctOn([t.reviews.prId], { prId: t.reviews.prId, runId: t.agentRuns.id })
      .from(t.reviews)
      .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.reviews.runId))
      .where(
        and(
          eq(t.reviews.workspaceId, workspaceId),
          inArray(t.reviews.prId, prIds),
          eq(t.reviews.kind, 'review'),
          eq(t.agentRuns.status, 'done'),
        ),
      )
      .orderBy(t.reviews.prId, desc(t.agentRuns.ranAt), desc(t.reviews.createdAt));
    for (const row of rows) out.set(row.prId, row.runId);
    return out;
  }

  /**
   * Open findings of those runs (dismissed excluded), grouped per PR and
   * severity in SQL. Keyed by prId, ready for `rollupSeverities`.
   */
  async openSeverityCountsByRun(
    workspaceId: string,
    runIds: string[],
  ): Promise<Map<string, SeverityCount[]>> {
    const out = new Map<string, SeverityCount[]>();
    if (runIds.length === 0) return out;
    const rows = await this.db
      .select({ prId: t.reviews.prId, severity: t.findings.severity, n: count() })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .where(
        and(
          eq(t.reviews.workspaceId, workspaceId),
          inArray(t.reviews.runId, runIds),
          eq(t.reviews.kind, 'review'),
          isNull(t.findings.dismissedAt),
        ),
      )
      .groupBy(t.reviews.prId, t.findings.severity);
    for (const row of rows) {
      out.set(row.prId, [...(out.get(row.prId) ?? []), { severity: row.severity, n: row.n }]);
    }
    return out;
  }
}
