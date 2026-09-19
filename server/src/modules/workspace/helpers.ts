import type { RepoRow } from '../../db/rows.js';

/** One row of the workspace overview's cloned-repos summary. */
export interface WorkspaceRepoSummary {
  id: string;
  full_name: string;
  clone_path: string | null;
  last_polled_at: string | null;
  cloned: boolean;
}

/**
 * Pure row → summary mapping. `cloned` is derived from the clone path rather
 * than stored, so it can never disagree with it.
 */
export function toRepoSummary(r: RepoRow): WorkspaceRepoSummary {
  return {
    id: r.id,
    full_name: r.fullName,
    clone_path: r.clonePath,
    last_polled_at: r.lastPolledAt?.toISOString() ?? null,
    cloned: Boolean(r.clonePath),
  };
}
