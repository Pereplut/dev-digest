/**
 * Plain value shapes shared by the pulls helpers (ring 1) and repository.
 * Imports nothing: helpers.ts depends on this file, never on the data layer,
 * and the repository imports from here too, so no helpers <-> repository cycle
 * can form (`no-circular` sees type-only imports; see server/INSIGHTS.md).
 */

/** Decoded page boundary: the last row of the previous page. */
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
