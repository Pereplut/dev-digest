/**
 * core/errors.ts — ring 1 (core). Pure free functions building the tool-error
 * texts (spec 0011 "Error texts — use verbatim") and mapping the API's
 * `ApiErrorBody` onto them. No MCP SDK, no Zod, no `fetch` — the six texts
 * below are copied from the spec character-for-character except for the
 * bracketed placeholders, which are acceptance criteria, not illustrations.
 */
import type { AgentSummary, RunStatusValue } from '../ports.js';
import { enabledAgentNames } from './project.js';

/** Structural mirror of `@devdigest/shared`'s `ApiErrorBody` — ring 1 does not
 * import Zod, so this is a plain shape, not the schema's inferred type. */
export interface ApiErrorLike {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * The "N of M agents done" clause is only derivable when `get_findings` was
 * called with `repo`+`pull_number`: only then is the pull id known, so the
 * sibling runs can be counted via `GET /pulls/:id/runs`. `GET
 * /runs/:id/findings` (the `run_id` path) returns neither a pull id nor any
 * sibling-run information, so that mode omits the clause rather than
 * fabricating it — a deviation from spec 0011's single verbatim text,
 * confirmed with the server agent building the route.
 */
export type StillRunningInfo =
  | { mode: 'run'; runId: string; status: RunStatusValue }
  | { mode: 'pull'; runId: string; status: RunStatusValue; agentsTotal: number; agentsDone: number };

/**
 * `run_id` mode: `Run <id> is still executing (status: running). Call
 * get_findings again with the same run_id in a few seconds. Do not call
 * review_pull_request again.`
 *
 * `repo`+`pull_number` mode (verbatim spec 0011 text): `Run <id> is still
 * executing (status: running, 2 of 3 agents done). Call get_findings again
 * with the same run_id in a few seconds. Do not call review_pull_request
 * again.`
 */
export function runStillExecutingText(info: StillRunningInfo): string {
  const progress = info.mode === 'pull' ? `, ${info.agentsDone} of ${info.agentsTotal} agents done` : '';
  return (
    `Run ${info.runId} is still executing (status: ${info.status}${progress}). Call get_findings ` +
    `again with the same run_id in a few seconds. Do not call review_pull_request again.`
  );
}

/**
 * `Agent "<name>" is disabled and cannot be run. Enabled agents: <list>. Omit
 * the agent parameter to run all enabled agents.`
 */
export function agentDisabledText(agentName: string, allAgents: AgentSummary[]): string {
  const list = enabledAgentNames(allAgents).join(', ');
  return (
    `Agent "${agentName}" is disabled and cannot be run. Enabled agents: ${list}. Omit the ` +
    `agent parameter to run all enabled agents.`
  );
}

/**
 * `No repository "<given>" in this workspace. Did you mean "<closest>"? Call
 * list_review_agents to see the workspace, or add the repository in the
 * DevDigest UI.`
 *
 * When the workspace has no repositories to suggest at all (`closest` is
 * null), the "Did you mean" sentence is dropped rather than naming a
 * nonexistent repo — the two sentences either side stay verbatim.
 */
export function repositoryUnknownText(given: string, closest: string | null): string {
  const didYouMean = closest ? ` Did you mean "${closest}"?` : '';
  return (
    `No repository "${given}" in this workspace.${didYouMean} Call list_review_agents to see the ` +
    `workspace, or add the repository in the DevDigest UI.`
  );
}

/**
 * `Pass either run_id or repo+pull_number, not both. run_id reads one agent's
 * result; repo+pull_number reads the latest from every agent.`
 */
export function bothRunIdAndRepoText(): string {
  return (
    "Pass either run_id or repo+pull_number, not both. run_id reads one agent's result; " +
    'repo+pull_number reads the latest from every agent.'
  );
}

/**
 * `Cannot reach the DevDigest API at <url>. Start it with ./scripts/dev.sh
 * from the repository root.`
 */
export function apiUnreachableText(url: string): string {
  return `Cannot reach the DevDigest API at ${url}. Start it with ./scripts/dev.sh from the repository root.`;
}

/**
 * `No pull request #<n> in <repo>. DevDigest only knows pull requests it has
 * synced from GitHub — open that repository in the DevDigest UI and refresh
 * its pull request list, then call get_blast_radius again. If the number
 * came from a link or a branch name, check it against GitHub first: this is
 * the PR number, not an internal id.`
 *
 * Verbatim from spec 0012 §6. `<n>` and `<repo>` are `get_blast_radius`'s own
 * `pull_number` and `repo` arguments, echoed back the way
 * `repositoryUnknownText` echoes `given`.
 */
export function blastPullRequestUnknownText(pullNumber: number, repo: string): string {
  return (
    `No pull request #${pullNumber} in ${repo}. DevDigest only knows pull requests it has synced ` +
    'from GitHub — open that repository in the DevDigest UI and refresh its pull request list, ' +
    'then call get_blast_radius again. If the number came from a link or a branch name, check it ' +
    'against GitHub first: this is the PR number, not an internal id.'
  );
}

/**
 * Maps a non-2xx `ApiErrorBody` onto a tool-error text for situations outside
 * the six named above (e.g. a 404 pull/agent/run the caller misidentified).
 *
 * The API's own message always comes first, so nothing is swallowed — but it is
 * written for a developer reading a log, not for a model deciding what to do
 * next. A bare `Run not found` names the failure and no recovery, which is the
 * one thing spec 0011's "errors are context, not dead ends" rules out. So each
 * status class gets a recovery clause appended.
 */
export function apiErrorText(status: number, body: ApiErrorLike | null, fallback?: string): string {
  const raw = body?.error.message ?? fallback ?? `DevDigest API returned ${status}`;
  const message = raw.replace(/\.?$/, '.');
  const hint = recoveryHint(status);
  return hint ? `${message} ${hint}` : message;
}

/**
 * The next action for an HTTP status class. An unrecognised status adds nothing
 * rather than guessing.
 *
 * Keyed on the numeric status, deliberately NOT on `ApiErrorBody.error.code`:
 * that field carries the API's own semantic codes (`invalid_run_request`,
 * `invalid_cursor`, …), a different and open vocabulary. Conflating the two is
 * how this function previously ended up receiving a stringified status in a
 * field typed as a semantic code.
 */
function recoveryHint(status: number): string | null {
  switch (status) {
    case 404:
      return (
        'Ids are not guessable: run ids come from review_pull_request, agent ids from ' +
        'list_review_agents. To read a pull request without a run id, call get_findings with ' +
        'repo and pull_number instead.'
      );
    case 400:
    case 422:
      return "Check the argument shapes against this tool's schema and call it again.";
    case 429:
      return 'This is the 10-calls-per-minute limit on starting reviews. Wait a minute before retrying.';
    default:
      return status >= 500
        ? 'This is a DevDigest API fault, not a bad argument. Retrying the same call is reasonable; if it persists, check the API logs.'
        : null;
  }
}

/**
 * A cursor that does not decode. Not one of spec 0011's six texts, but it obeys
 * the same rule: name the next action, not just the failure.
 *
 * It names the likely cause too, because the likely cause is not corruption.
 * The `run_id` path's `next_cursor` is the server's base64 `"<rank>|<uuid>"`
 * and this path's is a base64 `{offset}` — two formats, so moving a cursor
 * between the two modes is the ordinary mistake, and a caller told only
 * "invalid" would reasonably retry the same value.
 */
export function invalidCursorText(): string {
  return (
    'Invalid cursor. Pass back the exact next_cursor from this tool\'s previous response — cursors ' +
    'are not interchangeable between the run_id and repo+pull_number modes. Omit cursor to start ' +
    'from the first page.'
  );
}
