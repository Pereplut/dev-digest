import type { BlastRadius } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { buildBlastRadius } from './helpers.js';

/**
 * L04 — Blast radius service: the reviewer-facing projection of
 * `repoIntel.getBlastRadius`.
 *
 * It owns no repository. Both reads go through `container.reviewRepo`, the
 * composition root's shared repository for pulls/reviews — the sanctioned way
 * for one module to read another's entities without importing its internals
 * (same rationale `SmartDiffService` documents at its `service.ts:8-11`).
 *
 * There is NO model call on this path and no clone parsing: the request only
 * reads the finished index through the single `repoIntel.getBlastRadius` call,
 * with `indexOnly: true` so the facade never falls through to its best-effort
 * path (which reads the clone at request time) when no persistent index is
 * usable — AC12 is literally true for this route (spec 0012).
 */
export class BlastService {
  constructor(private container: Container) {}

  async forPull(workspaceId: string, prId: string): Promise<BlastRadius> {
    const repo = this.container.reviewRepo;

    // Tenancy FIRST: a PR in another workspace (or an unknown PR) must 404
    // before the index is touched — the facade call never runs otherwise.
    const pull = await repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await repo.getPrFiles(prId);
    const result = await this.container.repoIntel.getBlastRadius(
      pull.repoId,
      files.map((f) => f.path),
      { indexOnly: true },
    );

    return buildBlastRadius(result);
  }
}
