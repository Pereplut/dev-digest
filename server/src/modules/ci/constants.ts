import { fileURLToPath } from 'node:url';

/**
 * Shared constants for the CI export (manifest, slug, workflow, service).
 * Pure data — no I/O, no adapters. Every name that the generated workflow and
 * the runner (`agent-runner/src/{context,index}.ts`) must agree on lives here.
 */

// ---------------------------------------------------------------------------
// `.devdigest/` on-disk layout (written into the TARGET repo by the export)
// ---------------------------------------------------------------------------

export const DEVDIGEST_DIR = '.devdigest';
export const AGENTS_DIR = `${DEVDIGEST_DIR}/agents`;
export const SKILLS_DIR = `${DEVDIGEST_DIR}/skills`;
export const MEMORY_FILE_PATH = `${DEVDIGEST_DIR}/memory.jsonl`;
export const RUNNER_DIR = `${DEVDIGEST_DIR}/runner`;
/** The bundled agent-runner entry point — invoked directly, never via a marketplace action. */
export const RUNNER_ENTRY_PATH = `${RUNNER_DIR}/index.js`;
/** The one command the review step runs. */
export const RUNNER_RUN_COMMAND = `node ${RUNNER_ENTRY_PATH}`;

export function agentManifestPath(slug: string): string {
  return `${AGENTS_DIR}/${slug}.yaml`;
}

export function skillFilePath(slug: string): string {
  return `${SKILLS_DIR}/${slug}.md`;
}

/** Where the runner bundle is built (`cd agent-runner && npm run build`). */
export const DEFAULT_RUNNER_DIST_DIR = fileURLToPath(
  new URL('../../../../agent-runner/dist/', import.meta.url),
);

// ---------------------------------------------------------------------------
// GitHub Actions workflow
// ---------------------------------------------------------------------------

/** Install path of the generated workflow. */
export const GHA_WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';
/** The same workflow addressed by file name for `listWorkflowRuns`. */
export const GHA_WORKFLOW_FILE = 'devdigest-review.yml';

/** The only `pull_request` event types the generated workflow may trigger on. */
export const ALLOWED_PULL_REQUEST_EVENTS = ['opened', 'synchronize', 'reopened'] as const;
export type AllowedPullRequestEvent = (typeof ALLOWED_PULL_REQUEST_EVENTS)[number];

/** Matches the `CiExportInput.triggers` default in `contracts/eval-ci.ts`. */
export const DEFAULT_PULL_REQUEST_EVENTS: readonly AllowedPullRequestEvent[] = [
  'opened',
  'synchronize',
];

/**
 * Event names that must NEVER appear in a generated workflow's `on:` block:
 * they run with base-repo secrets/permissions, or fire on attacker-controlled
 * comments — the classic secret-exfiltration vectors. Kept here so tests can
 * assert their absence by name.
 */
export const FORBIDDEN_TRIGGER_EVENTS = [
  'issue_comment',
  'pull_request_review_comment',
  'pull_request_target',
  'workflow_run',
] as const;

/** The exact, least-privilege permission set of the workflow (top level only). Order is significant. */
export const GHA_PERMISSIONS: readonly (readonly [string, 'read' | 'write'])[] = [
  ['contents', 'read'],
  ['pull-requests', 'write'],
];

/** Secret reference expressions — NEVER a literal value. */
export const OPENROUTER_SECRET_EXPR = '${{ secrets.OPENROUTER_API_KEY }}';
export const GITHUB_TOKEN_SECRET_EXPR = '${{ secrets.GITHUB_TOKEN }}';

/** Job gate: fork PRs never receive the secrets (head repo must be the base repo). */
export const FORK_GATE_CONDITION =
  'github.event.pull_request.head.repo.full_name == github.repository';

/** GitHub Actions context expressions used in the generated workflow (non-secret). */
export const PR_BASE_SHA_EXPR = '${{ github.event.pull_request.base.sha }}';
/** The PR head SHA, NOT `github.sha` (the merge commit): it equals the workflow run's `head_sha`. */
export const PR_HEAD_SHA_EXPR = '${{ github.event.pull_request.head.sha }}';
export const GITHUB_REPOSITORY_EXPR = '${{ github.repository }}';
export const REPOSITORY_ID_EXPR = '${{ github.repository_id }}';
export const PR_NUMBER_EXPR = '${{ github.event.pull_request.number }}';

/** Env var names shared with `agent-runner/src/{context,index}.ts`. */
export const ENV_OPENROUTER_API_KEY = 'OPENROUTER_API_KEY';
export const ENV_GITHUB_TOKEN = 'GITHUB_TOKEN';
export const ENV_GITHUB_REPOSITORY = 'GITHUB_REPOSITORY';
export const ENV_PR_NUMBER = 'PR_NUMBER';
export const ENV_COMMIT_SHA = 'DEVDIGEST_COMMIT_SHA';
export const ENV_REPOSITORY_ID = 'DEVDIGEST_REPOSITORY_ID';
export const ENV_POST_AS = 'DEVDIGEST_POST_AS';

/**
 * Third-party actions, pinned to a full commit SHA (a tag can be moved; a SHA
 * cannot). Each SHA is the commit the `v4` tag pointed at on 2026-10-15.
 */
export const PIN = {
  checkout: 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262', // v4
  setupNode: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020', // v4
  uploadArtifact: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02', // v4
} as const;

/**
 * Name of the Actions artifact the workflow uploads and refresh downloads. One
 * constant, so the generator and the consumer cannot drift apart.
 */
export const CI_RESULT_ARTIFACT_NAME = 'devdigest-result';

/**
 * Filename the runner writes inside the job workspace (the default of the
 * runner's `DEVDIGEST_RESULT_PATH`) — also the entry name inside the artifact zip.
 */
export const CI_RESULT_FILE_NAME = 'devdigest-result.json';

/** Values the runner's `resolvePostAs` accepts. */
export const POST_AS_VALUES = ['github_review', 'pr_comment', 'none'] as const;
export type CiPostAsValue = (typeof POST_AS_VALUES)[number];
export const DEFAULT_POST_AS: CiPostAsValue = 'github_review';

// ---------------------------------------------------------------------------
// Export / refresh limits and names
// ---------------------------------------------------------------------------

/** Completed workflow runs examined per installation per refresh. */
export const MAX_RUNS_PER_REFRESH = 30;
/** Rows `GET /ci/runs` returns; no paging. */
export const MAX_CI_RUNS_LISTED = 100;
/** Upper bound on the artifact JSON read out of the downloaded zip. */
export const MAX_ARTIFACT_JSON_BYTES = 1_000_000;
/** Branch the export commits to. */
export const CI_BRANCH = 'devdigest/ci';
