import type { PrMeta } from '@devdigest/shared';
import type { PollUpsertValues } from './repository/poll.repo.js';

/**
 * Pure mapping for the polling module — no DB, no `this`.
 *
 * NOTE the difference from `pulls/helpers.ts#toPullUpsert`: a poll does not
 * write `opened_at`. That asymmetry predates the extraction and is preserved
 * verbatim; changing it would alter what a poll persists for a PR the list
 * route has never seen.
 */
export function toPollUpsert(
  workspaceId: string,
  repoId: string,
  pr: PrMeta,
): PollUpsertValues {
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
    updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
  };
}
