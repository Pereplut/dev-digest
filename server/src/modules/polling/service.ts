import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { PollingRepository } from './repository/poll.repo.js';
import { toPollUpsert } from './helpers.js';

/**
 * F1 — polling service. MANUAL refresh that ONLY syncs the PR list (new and
 * updated PRs appear, head_sha updates). It does NOT trigger any review —
 * review is manual, owned by A2.
 *
 * Unlike the pulls list, this path does NOT degrade when GitHub is
 * unreachable: a poll is an explicit user action, so `container.github()`
 * rejecting propagates and the request fails loudly. That is the
 * pre-extraction behaviour and it is the right one — silently reporting
 * "synced 0" would look like an up-to-date repo.
 */

export interface PollResult {
  synced: number;
  reviewTriggered: false;
}

export class PollingService {
  constructor(
    private container: Container,
    private repo: PollingRepository = new PollingRepository(container.db),
  ) {}

  async poll(workspaceId: string, repoId: string): Promise<PollResult> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const gh = await this.container.github();
    const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });

    let synced = 0;
    for (const pr of pulls) {
      await this.repo.upsertPull(toPollUpsert(workspaceId, repo.id, pr));
      synced++;
    }
    await this.repo.touchLastPolled(repo.id);

    return { synced, reviewTriggered: false };
  }
}
