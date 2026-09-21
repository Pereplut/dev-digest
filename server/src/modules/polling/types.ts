/**
 * Plain value shapes for the polling module. Imports nothing, so both the pure
 * helpers (ring 1) and the repository can depend on it without helpers.ts
 * reaching into the data layer.
 */

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
