import type { PrDetail, PrMeta } from '@devdigest/shared';
import type { PrCommitRow, PrFileRow, PullRow } from '../../db/rows.js';
import { deriveReviewStatus, rollupSeverities } from './status.js';
import type { PrCost, PullCursor, SeverityCount, UpsertPullValues } from './types.js';

/**
 * Pure row → contract mapping for the pulls module. No DB, no `this`, so it
 * unit-tests as cheaply as `status.ts` does.
 *
 * Kept separate from the repository on purpose: SKILL.md §11 deviation 6 notes
 * that some repositories return mapped DTOs instead of rows and says to prefer
 * helper mapping for new code. So the repository speaks rows and plain values,
 * and every snake_case contract shape is built here.
 */

/**
 * Encode a page boundary. Opaque to the client on purpose — it is an
 * implementation detail of the ordering, not an API the caller composes.
 * `base64url` so it survives a query string without escaping.
 */
export function encodePullCursor(row: PullRow): string {
  const key = (row.updatedAt ?? new Date(0)).toISOString();
  return Buffer.from(`${key}|${row.id}`, 'utf8').toString('base64url');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// What `toISOString()` emits for years 0000-9999; the extended `±YYYYYY` form
// round-trips in JS but Postgres refuses to parse it.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Decode a cursor; `null` for anything malformed, so a bad one is a 400 not a
 * 500. Both halves are checked strictly because the repository binds them into
 * SQL casts (`::timestamptz`, `::uuid`): a value Postgres rejects would surface
 * as a 500 carrying the driver's error text. The timestamp must round-trip
 * exactly as `encodePullCursor` wrote it, in the plain 4-digit-year form.
 */
export function decodePullCursor(raw: string): PullCursor | null {
  // base64url decoding never throws; junk input just decodes to junk.
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const sep = decoded.lastIndexOf('|');
  if (sep <= 0) return null;
  const iso = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  const updatedAt = new Date(iso);
  if (!ISO_RE.test(iso) || Number.isNaN(updatedAt.getTime()) || updatedAt.toISOString() !== iso) {
    return null;
  }
  if (!UUID_RE.test(id)) return null;
  return { updatedAt, id };
}

/** GitHub's PrMeta → the columns we persist for one imported PR. */
export function toPullUpsert(
  workspaceId: string,
  repoId: string,
  pr: PrMeta,
): UpsertPullValues {
  return {
    workspaceId,
    repoId,
    number: pr.number,
    title: pr.title,
    author: pr.author,
    branch: pr.branch,
    base: pr.base,
    headSha: pr.head_sha,
    additions: pr.additions,
    deletions: pr.deletions,
    filesCount: pr.files_count,
    status: pr.status,
    openedAt: pr.opened_at ? new Date(pr.opened_at) : null,
    updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
  };
}

/** The read-model bits the list joins onto each PR row. */
export interface PrMetaExtras {
  /** Latest review's score; `undefined` when the PR has no review at all. */
  score: number | null | undefined;
  cost: PrCost | undefined;
  /** Set only when a done run with a review exists — drives findings_counts. */
  findingsRunId: string | undefined;
  severityRows: SeverityCount[] | undefined;
  /** `Date.now()` once per request, so every row derives staleness alike. */
  now: number;
}

export function toPrMeta(row: PullRow, extras: PrMetaExtras): PrMeta {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    author: row.author,
    branch: row.branch,
    base: row.base,
    head_sha: row.headSha,
    additions: row.additions,
    deletions: row.deletions,
    files_count: row.filesCount,
    // The DB `status` column is GitHub's merge state; the review status
    // (needs_review / reviewed / stale) is derived for OPEN PRs.
    status: deriveReviewStatus({
      ghStatus: row.status,
      lastReviewedSha: row.lastReviewedSha,
      headSha: row.headSha,
      updatedAt: row.updatedAt,
      now: extras.now,
    }),
    opened_at: row.openedAt?.toISOString() ?? null,
    updated_at: row.updatedAt?.toISOString() ?? null,
    score: extras.score ?? null,
    cost_usd: extras.cost ? extras.cost.total : null,
    cost_complete: extras.cost ? extras.cost.complete : null,
    // No reviewed run → null, which the UI renders as "—". An empty rollup
    // would wrongly read as "reviewed, found nothing".
    findings_counts: extras.findingsRunId ? rollupSeverities(extras.severityRows ?? []) : null,
    findings_run_id: extras.findingsRunId ?? null,
  };
}

/**
 * Persisted rows → PrDetail, for the offline path where GitHub is unreachable
 * and we serve what was last imported (or seeded).
 */
export function toPrDetail(
  pr: PullRow,
  files: PrFileRow[],
  commits: PrCommitRow[],
): PrDetail {
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    author: pr.author,
    branch: pr.branch,
    base: pr.base,
    head_sha: pr.headSha,
    additions: pr.additions,
    deletions: pr.deletions,
    files_count: pr.filesCount,
    status: pr.status as PrDetail['status'],
    opened_at: pr.openedAt?.toISOString() ?? null,
    updated_at: pr.updatedAt?.toISOString() ?? null,
    body: pr.body ?? null,
    files: files.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ?? null,
    })),
    commits: commits.map((c) => ({
      sha: c.sha,
      message: c.message,
      author: c.author,
      committed_at: c.committedAt?.toISOString() ?? null,
    })),
  };
}
