import type {
  GitHubClient,
  PrCommentInput,
  PrDetail,
  PrPage,
  PrReviewComment,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { PinoLike } from '../../platform/run-logger.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { PullRow, RepoRow } from '../../db/rows.js';
import { PullsRepository } from './repository/pull.repo.js';
import {
  decodePullCursor,
  encodePullCursor,
  toPrDetail,
  toPrMeta,
  toPullUpsert,
} from './helpers.js';

/**
 * F1 — pulls service. PR import (Octokit list + per-PR detail) and the inline
 * review-comment proxy.
 *
 * LOCAL-FIRST is the rule throughout: when a GitHub token is missing or the
 * network is down we log and serve whatever was persisted, and never fail the
 * read. That is why nearly every GitHub call sits in its own try/catch.
 *
 * `logger` is a method argument rather than a constructor dependency, matching
 * ReviewService — so a test can call these without wiring a logger, and the
 * route passes Fastify's own.
 *
 * No HTTP and no raw SQL live here: persistence goes through PullsRepository,
 * pure transforms through helpers.ts and status.ts.
 */

/**
 * Diff stats are absent from GitHub's PR-list payload, so freshly-imported PRs
 * land with zeroed size. We backfill at most this many per request (each is a
 * detail fetch); the periodic refetch chips away at any remainder.
 */
const BACKFILL_LIMIT = 10;

export class PullsService {
  constructor(
    private container: Container,
    private repo: PullsRepository = new PullsRepository(container.db),
  ) {}

  /**
   * One page of the Pull Requests list: sync from GitHub when possible, then
   * serve the persisted rows decorated with score, cost and open-finding counts.
   *
   * Paginated because this endpoint used to read the repo's ENTIRE PR table and
   * then build three `IN` lists sized by that count. The decoration queries now
   * span one page, so the work per request is bounded by `limit` rather than by
   * how long the repo has existed.
   */
  async list(
    workspaceId: string,
    repoId: string,
    page: { limit: number; cursor?: string | undefined },
    logger?: PinoLike,
  ): Promise<PrPage> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    let gh: GitHubClient | null = null;
    try {
      gh = await this.container.github();
    } catch (err) {
      logger?.warn({ err }, 'GitHub client unavailable (no token / offline); serving persisted PRs');
    }

    if (gh) {
      try {
        const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
        for (const pr of pulls) {
          await this.repo.upsertFromGitHub(toPullUpsert(workspaceId, repo.id, pr));
        }
      } catch (err) {
        logger?.warn({ err }, 'GitHub PR sync skipped (no token / offline); serving persisted PRs');
      }
    }

    // A cursor that does not decode is the caller's mistake, not a server
    // fault: fail it as a 400 rather than silently serving page one.
    const cursor = page.cursor ? decodePullCursor(page.cursor) : undefined;
    if (page.cursor && !cursor) {
      throw new AppError('invalid_cursor', 'Malformed pagination cursor.', 400);
    }
    const { rows, hasMore } = await this.repo.listPageByRepo(repo.id, {
      limit: page.limit,
      ...(cursor ? { cursor } : {}),
    });

    if (gh) {
      const needStats = rows
        .filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0)
        .slice(0, BACKFILL_LIMIT);
      for (const r of needStats) {
        try {
          const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, r.number);
          await this.repo.updateDiffStats(r.id, {
            additions: detail.additions,
            deletions: detail.deletions,
            filesCount: detail.files_count,
          });
          // Mutate the in-memory row too, so THIS response already shows the
          // real size rather than waiting for the next request.
          r.additions = detail.additions;
          r.deletions = detail.deletions;
          r.filesCount = detail.files_count;
        } catch (err) {
          logger?.warn({ err, number: r.number }, 'PR diff-stat backfill skipped');
        }
      }
    }

    const prIds = rows.map((r) => r.id);
    const scoreByPr = await this.repo.latestReviewScoreByPr(prIds);
    const costByPr = await this.repo.costByPr(workspaceId, prIds);
    const findingsRunByPr = await this.repo.latestReviewedRunByPr(workspaceId, prIds);
    const severityRowsByPr = await this.repo.openSeverityCountsByRun(workspaceId, [
      ...findingsRunByPr.values(),
    ]);

    const now = Date.now();
    const items = rows.map((r) =>
      toPrMeta(r, {
        score: scoreByPr.get(r.id),
        cost: costByPr.get(r.id),
        findingsRunId: findingsRunByPr.get(r.id),
        severityRows: severityRowsByPr.get(r.id),
        now,
      }),
    );

    // The cursor is the LAST ROW of this page, and only when another exists —
    // so a caller can always tell "done" from "ask again" without a count.
    const last = rows[rows.length - 1];
    return { items, next_cursor: hasMore && last ? encodePullCursor(last) : null };
  }

  /**
   * Full PR detail. Refreshes files/commits/body from GitHub when a token is
   * configured; on ANY failure (no token, offline, or a write error) falls back
   * to the persisted rows so the page works offline.
   */
  async detail(workspaceId: string, prId: string, logger?: PinoLike): Promise<PrDetail> {
    const { pr, repo } = await this.resolvePrAndRepo(workspaceId, prId);
    return this.detailFor(pr, repo, logger);
  }

  /**
   * The same detail, addressed by repo + PR NUMBER — which is how the UI's
   * route is keyed.
   *
   * Without this the detail page had to load the entire PR list purely to turn
   * a number into a uuid, and that list endpoint syncs from GitHub and issues
   * up to BACKFILL_LIMIT extra detail fetches. One page view therefore paid for
   * a sync plus ~10 GitHub round-trips before its own request could start, and
   * every dependent query (reviews, runs) waited on it.
   */
  async detailByNumber(
    workspaceId: string,
    repoId: string,
    number: number,
    logger?: PinoLike,
  ): Promise<PrDetail> {
    const pr = await this.repo.getPullByNumber(workspaceId, repoId, number);
    if (!pr) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepoById(pr.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return this.detailFor(pr, repo, logger);
  }

  private async detailFor(
    pr: PullRow,
    repo: RepoRow,
    logger?: PinoLike,
  ): Promise<PrDetail> {
    try {
      const gh = await this.container.github();
      const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pr.number);

      await this.repo.saveDetail(
        pr.id,
        {
          body: detail.body ?? null,
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.files_count,
        },
        detail.files.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
        detail.commits.map((c) => ({
          sha: c.sha,
          message: c.message,
          author: c.author,
          committedAt: c.committed_at ? new Date(c.committed_at) : null,
        })),
      );

      return { ...detail, id: pr.id };
    } catch (err) {
      logger?.warn(
        { err },
        'GitHub PR detail refresh skipped (no token / offline); serving persisted detail',
      );
      const files = await this.repo.getFiles(pr.id);
      const commits = await this.repo.getCommits(pr.id);
      return toPrDetail(pr, files, commits);
    }
  }

  /**
   * Inline review comments are proxied live to GitHub with no local mirror, so
   * the Files changed tab stays in lock-step with the PR.
   */
  async listComments(
    workspaceId: string,
    prId: string,
    logger?: PinoLike,
  ): Promise<PrReviewComment[]> {
    const { pr, repo } = await this.resolvePrAndRepo(workspaceId, prId);
    let gh: GitHubClient;
    try {
      gh = await this.container.github();
    } catch (err) {
      logger?.warn({ err }, 'GitHub client unavailable; serving no PR comments');
      return [];
    }
    try {
      return await gh.listReviewComments({ owner: repo.owner, name: repo.name }, pr.number);
    } catch (err) {
      logger?.warn({ err }, 'GitHub review-comments fetch skipped (offline / error)');
      return [];
    }
  }

  /** Post one inline comment, pinned to the PR's head sha. */
  async createComment(
    workspaceId: string,
    prId: string,
    input: PrCommentInput,
  ): Promise<PrReviewComment> {
    const { pr, repo } = await this.resolvePrAndRepo(workspaceId, prId);
    let gh: GitHubClient;
    try {
      gh = await this.container.github();
    } catch {
      throw new AppError('github_unavailable', 'Connect a GitHub token to post comments.', 400);
    }
    try {
      return await gh.createReviewComment({ owner: repo.owner, name: repo.name }, pr.number, {
        commitId: pr.headSha,
        path: input.path,
        line: input.line,
        ...(input.side ? { side: input.side } : {}),
        body: input.body,
        ...(input.in_reply_to != null ? { inReplyTo: input.in_reply_to } : {}),
      });
    } catch (err) {
      // GitHub rejects comments on lines outside the diff / on closed PRs (422).
      const msg = err instanceof Error ? err.message : 'Failed to post the comment to GitHub.';
      throw new AppError('github_comment_failed', msg, 400, { cause: String(err) });
    }
  }

  private async resolvePrAndRepo(workspaceId: string, prId: string) {
    const pr = await this.repo.getPull(workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepoById(pr.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return { pr, repo };
  }
}
