/**
 * tools/findings.ts — ring 3 (application). The only genuine orchestration
 * `get_findings` needs: run → findings + status (one call, one port method),
 * or slug → repo id → pull id → the latest findings from every agent. No MCP
 * SDK, no `fetch`, no Zod — projection into concise/detailed happens one ring
 * out, in registry.ts, so this stays a pure port-consumer.
 *
 * The "still executing" progress clause ("2 of 3 agents done") is only
 * available in the repo+pull_number path: `GET /runs/:id/findings` (the
 * run_id path) returns just that run's own status, with no pull id and no
 * sibling-run information, so it cannot be derived there (confirmed with the
 * server agent building the route — see `core/errors.ts`'s `StillRunningInfo`).
 */
import type {
  DevDigestApi,
  FindingCategory,
  FindingItem,
  RunStatusValue,
  Severity,
} from '../ports.js';
import { currentWave, filterFindings, paginate, resolveRepoSlug } from '../core/project.js';
import { invalidCursorText, repositoryUnknownText, type StillRunningInfo } from '../core/errors.js';

interface CommonFilters {
  severity?: Severity[];
  category?: FindingCategory[];
  limit: number;
  cursor?: string;
}

export type GetFindingsInput =
  | ({ by: 'run'; runId: string } & CommonFilters)
  | ({ by: 'pull'; repo: string; pullNumber: number } & CommonFilters);

export type GetFindingsResult =
  | {
      kind: 'ok';
      findings: FindingItem[];
      nextCursor: string | null;
      status: RunStatusValue | null;
      grounding: string | null;
    }
  | { kind: 'still-running'; info: StillRunningInfo }
  | { kind: 'error'; text: string };

export async function getFindings(api: DevDigestApi, input: GetFindingsInput): Promise<GetFindingsResult> {
  if (input.by === 'run') {
    const page = await api.getRunFindings(input.runId, {
      ...(input.severity ? { severity: input.severity } : {}),
      ...(input.category ? { category: input.category } : {}),
      limit: input.limit,
      ...(input.cursor ? { cursor: input.cursor } : {}),
    });
    if (page.status === 'running') {
      return { kind: 'still-running', info: { mode: 'run', runId: input.runId, status: 'running' } };
    }
    return {
      kind: 'ok',
      findings: page.findings,
      nextCursor: page.nextCursor,
      status: page.status,
      grounding: page.grounding,
    };
  }

  const repos = await api.listRepos();
  const resolution = resolveRepoSlug(repos, input.repo);
  if (!resolution.ok) {
    return { kind: 'error', text: repositoryUnknownText(input.repo, resolution.closest) };
  }

  const pull = await api.getPullByNumber(resolution.repo.id, input.pullNumber);
  if (!pull) {
    return {
      kind: 'error',
      text: `No pull request #${input.pullNumber} in ${resolution.repo.fullName}. Check the number and try again.`,
    };
  }

  // The pull id is known here, so the sibling runs CAN be counted — this is
  // the one path that legitimately supports the "N of M agents done" clause.
  const runs = await api.listRunsForPull(pull.id);
  // Only the current wave counts: a "latest run per agent" tally silently
  // includes historical runs (including ones whose agent has since been
  // deleted), producing a denominator that can never be reached. See
  // `currentWave`.
  const batch = currentWave(runs);
  const running = batch.find((r) => r.status === 'running');
  if (running) {
    const done = batch.filter((r) => r.status === 'done').length;
    return {
      kind: 'still-running',
      info: { mode: 'pull', runId: running.runId, status: 'running', agentsTotal: batch.length, agentsDone: done },
    };
  }

  const reviews = await api.listReviews(pull.id);
  const all = reviews.flatMap((r) => r.findings);
  const filtered = filterFindings(all, {
    ...(input.severity ? { severity: input.severity } : {}),
    ...(input.category ? { category: input.category } : {}),
  });
  const paged = paginate(filtered, { limit: input.limit, ...(input.cursor ? { cursor: input.cursor } : {}) });
  if (!paged.ok) return { kind: 'error', text: invalidCursorText() };

  // No grounding in the pull path: it is a per-run tally, and this path merges
  // the latest review of every agent. Reporting one run's figure for all of them
  // would be worse than omitting it.
  return {
    kind: 'ok',
    findings: paged.page.items,
    nextCursor: paged.page.nextCursor,
    status: null,
    grounding: null,
  };
}
