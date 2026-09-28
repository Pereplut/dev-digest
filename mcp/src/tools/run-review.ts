/**
 * tools/run-review.ts — ring 3 (application). The only genuine orchestration
 * `review_pull_request` needs: slug → repo id → pull id → start. No MCP SDK,
 * no `fetch` — everything reaches the API through the `DevDigestApi` port, so
 * this is exercisable with `MockDevDigestApi` and no network.
 */
import type { AgentSummary, DevDigestApi, StartedRun } from '../ports.js';
import { resolveRepoSlug } from '../core/project.js';
import { agentDisabledText, repositoryUnknownText } from '../core/errors.js';

export interface RunReviewInput {
  repo: string;
  pullNumber: number;
  agentId?: string;
}

export type RunReviewResult =
  | { kind: 'ok'; runs: StartedRun[] }
  | { kind: 'error'; text: string };

export async function runReview(api: DevDigestApi, input: RunReviewInput): Promise<RunReviewResult> {
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

  let agents: AgentSummary[] | null = null;
  if (input.agentId) {
    agents = await api.listAgents();
    const agent = agents.find((a) => a.id === input.agentId);
    if (!agent) {
      return {
        kind: 'error',
        text: `No agent "${input.agentId}". Call list_review_agents to see available agent ids.`,
      };
    }
    if (!agent.enabled) {
      return { kind: 'error', text: agentDisabledText(agent.name, agents) };
    }
    const runs = await api.startReview(pull.id, { agentId: agent.id });
    return { kind: 'ok', runs };
  }

  const runs = await api.startReview(pull.id, { all: true });
  return { kind: 'ok', runs };
}
