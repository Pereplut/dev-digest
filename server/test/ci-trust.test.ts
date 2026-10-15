import { describe, it, expect } from 'vitest';
import type { WorkflowRunSummary } from '@devdigest/shared';
import { isTrustedRun } from '../src/modules/ci/helpers.js';

/**
 * isTrustedRun: only a `pull_request` run whose head commit lives in the
 * installation's own repository may have its artifact read; a fork PR runs its
 * own copy of the workflow and can forge `devdigest-result`.
 */

const installation = { repo: 'acme/widgets' };

function runOf(over: Partial<Pick<WorkflowRunSummary, 'event' | 'headRepoFullName'>>) {
  return { event: 'pull_request', headRepoFullName: 'acme/widgets', ...over };
}

describe('isTrustedRun', () => {
  it('accepts a pull_request run from the installation repository, in any letter case', () => {
    expect(isTrustedRun(runOf({}), installation)).toBe(true);
    expect(isTrustedRun(runOf({ headRepoFullName: 'ACME/Widgets' }), installation)).toBe(true);
    expect(isTrustedRun(runOf({}), { repo: 'Acme/WIDGETS' })).toBe(true);
  });

  it('rejects a fork head repository, including a look-alike owner or name', () => {
    expect(isTrustedRun(runOf({ headRepoFullName: 'mallory/widgets' }), installation)).toBe(false);
    expect(isTrustedRun(runOf({ headRepoFullName: 'acme/widgets-fork' }), installation)).toBe(false);
    expect(isTrustedRun(runOf({ headRepoFullName: 'acme/widgets/' }), installation)).toBe(false);
  });

  it('rejects an unknown head repository (fails closed), null or empty', () => {
    expect(isTrustedRun(runOf({ headRepoFullName: null }), installation)).toBe(false);
    expect(isTrustedRun(runOf({ headRepoFullName: '' }), installation)).toBe(false);
  });

  it('rejects every event other than pull_request, even from the same repository', () => {
    for (const event of ['workflow_dispatch', 'push', 'pull_request_target', 'schedule', '']) {
      expect(isTrustedRun(runOf({ event }), installation)).toBe(false);
    }
  });
});
