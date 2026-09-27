import type { SmartDiff } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { buildSmartDiff } from './helpers.js';

/**
 * L03 — Smart Diff service: the reviewer-ordered projection of a PR's files.
 *
 * It owns no repository. Both reads go through `container.reviewRepo`, the
 * composition root's shared repository for pulls/reviews — the sanctioned way for
 * one module to read another's entities without importing its internals.
 *
 * There is NO model call on this path and no GitHub call: grouping is a pure
 * function of paths the DB already holds, which is why it works before the first
 * review has ever run (spec 0010, AC 9).
 */
export class SmartDiffService {
  constructor(private container: Container) {}

  async forPull(workspaceId: string, prId: string): Promise<SmartDiff> {
    const repo = this.container.reviewRepo;

    // Tenancy FIRST: a PR in another workspace must 404 before anything is read.
    const pull = await repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await repo.getPrFiles(prId);
    const findings = await repo.latestReviewFindings(workspaceId, prId);

    // Both empty states are normal, not errors: `pr_files` is written as a side
    // effect of a detail fetch, and a PR with no review yet simply has no lines.
    return buildSmartDiff(files, findings);
  }
}
