import type { Container } from '../../platform/container.js';
import { WorkspaceRepository } from './repository/workspace.repo.js';
import { toRepoSummary, type WorkspaceRepoSummary } from './helpers.js';

/**
 * F1 — workspace manager: where clones live, plus a summary of cloned repos.
 *
 * Cleanup and re-pull of individual repos belong to the repos module
 * (refresh/delete); this surface only gives the UI an overview.
 */

export interface WorkspaceOverview {
  workspaceId: string;
  cloneDir: string;
  repos: WorkspaceRepoSummary[];
}

export class WorkspaceService {
  constructor(
    private container: Container,
    private repo: WorkspaceRepository = new WorkspaceRepository(container.db),
  ) {}

  async overview(workspaceId: string): Promise<WorkspaceOverview> {
    const repos = await this.repo.listRepos(workspaceId);
    return {
      workspaceId,
      // The clone directory is configuration, not data — read from config so
      // the answer matches where the git adapter actually writes.
      cloneDir: this.container.config.cloneDir,
      repos: repos.map(toRepoSummary),
    };
  }
}
