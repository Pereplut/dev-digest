import { readFileSync } from 'node:fs';
import { RunnerError } from './errors.js';

/**
 * Resolves the PR context (owner/repo/number/title/body/fork) from the
 * GitHub-Actions-injected env vars + the standard `pull_request` event
 * payload — "the CI context" the runner assembles the diff + PR body/title
 * from (T8 action). `GITHUB_REPOSITORY` and `PR_NUMBER` are explicit env vars
 * the generated workflow sets (`server/src/modules/ci/workflow.ts`);
 * `GITHUB_EVENT_PATH` is a default GitHub Actions runtime var (always present)
 * pointing at the JSON payload for the triggering event, which carries the
 * (untrusted, author-controlled) PR title/body and the fork flag.
 */

export interface CiEnv {
  GITHUB_REPOSITORY?: string;
  PR_NUMBER?: string;
  GITHUB_EVENT_PATH?: string;
  /** PR head SHA (40 hex) the workflow passes; stamped on every artifact entry. */
  DEVDIGEST_COMMIT_SHA?: string;
  /** Numeric GitHub repository id the workflow passes; stamped on every artifact entry. */
  DEVDIGEST_REPOSITORY_ID?: string;
  [key: string]: string | undefined;
}

export interface PrContext {
  owner: string;
  repo: string;
  prNumber: number;
  /** PR title (untrusted, author-controlled). */
  title: string;
  /** PR body/description (untrusted, author-controlled). */
  body: string;
  /** True when the PR head is a fork — informational only; the workflow
   *  itself is responsible for never scheduling this job for fork PRs. */
  isFork: boolean;
  /** PR head branch name (untrusted, author-controlled). */
  headRef: string;
  /** PR base branch name. */
  baseRef: string;
  /** Validated PR head SHA (lowercase 40-hex). */
  commitSha: string;
  /** Validated numeric repository id. */
  repositoryId: number;
}

export interface CiIdentity {
  commitSha: string;
  repositoryId: number;
}

interface PullRequestEventPayload {
  pull_request?: {
    number?: number;
    title?: string;
    body?: string | null;
    head?: { ref?: string; repo?: { fork?: boolean } | null };
    base?: { ref?: string };
  };
}

function readEventPayload(
  eventPath: string | undefined,
  readFile: typeof readFileSync,
): PullRequestEventPayload | null {
  if (!eventPath) return null;
  let raw: string;
  try {
    raw = readFile(eventPath, 'utf8') as unknown as string;
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as PullRequestEventPayload;
  } catch {
    return null;
  }
}

/**
 * Validate the two env values every artifact entry must carry. Throws before
 * any manifest is loaded: without them no valid artifact can be built, so the
 * run writes nothing.
 */
export function resolveCiIdentity(env: CiEnv): CiIdentity {
  const commitSha = env.DEVDIGEST_COMMIT_SHA;
  if (!commitSha || !/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new RunnerError('DEVDIGEST_COMMIT_SHA must be a 40-character lowercase hex SHA');
  }
  const idRaw = env.DEVDIGEST_REPOSITORY_ID;
  const repositoryId = idRaw && /^\d+$/.test(idRaw) ? Number(idRaw) : NaN;
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
    throw new RunnerError('DEVDIGEST_REPOSITORY_ID must be a positive integer');
  }
  return { commitSha, repositoryId };
}

/** Resolve the PR context from env + (best-effort) event payload. */
export function resolvePrContext(
  env: CiEnv,
  readFile: typeof readFileSync = readFileSync,
): PrContext {
  const identity = resolveCiIdentity(env);
  const repository = env.GITHUB_REPOSITORY;
  if (!repository || !repository.includes('/')) {
    throw new RunnerError(
      `GITHUB_REPOSITORY must be set to "owner/name" (got: ${JSON.stringify(repository)})`,
    );
  }
  const [owner, repo] = repository.split('/', 2) as [string, string];

  const event = readEventPayload(env.GITHUB_EVENT_PATH, readFile);
  const pr = event?.pull_request;

  const prNumberRaw = env.PR_NUMBER ?? (pr?.number != null ? String(pr.number) : undefined);
  const prNumber = prNumberRaw ? Number(prNumberRaw) : NaN;
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new RunnerError(
      `PR_NUMBER must resolve to a positive integer (env PR_NUMBER=${JSON.stringify(env.PR_NUMBER)}, event pull_request.number=${JSON.stringify(pr?.number)})`,
    );
  }

  return {
    owner,
    repo,
    prNumber,
    title: pr?.title ?? '',
    body: pr?.body ?? '',
    isFork: pr?.head?.repo?.fork ?? false,
    headRef: pr?.head?.ref ?? '',
    baseRef: pr?.base?.ref ?? '',
    ...identity,
  };
}
