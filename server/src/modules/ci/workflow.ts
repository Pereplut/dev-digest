import type { CiFile } from '@devdigest/shared';
import {
  ALLOWED_PULL_REQUEST_EVENTS,
  CI_RESULT_ARTIFACT_NAME,
  CI_RESULT_FILE_NAME,
  DEFAULT_POST_AS,
  DEFAULT_PULL_REQUEST_EVENTS,
  ENV_COMMIT_SHA,
  ENV_GITHUB_REPOSITORY,
  ENV_GITHUB_TOKEN,
  ENV_OPENROUTER_API_KEY,
  ENV_POST_AS,
  ENV_PR_NUMBER,
  ENV_REPOSITORY_ID,
  FORK_GATE_CONDITION,
  GHA_PERMISSIONS,
  GHA_WORKFLOW_PATH,
  GITHUB_REPOSITORY_EXPR,
  GITHUB_TOKEN_SECRET_EXPR,
  OPENROUTER_SECRET_EXPR,
  PIN,
  POST_AS_VALUES,
  PR_BASE_SHA_EXPR,
  PR_HEAD_SHA_EXPR,
  PR_NUMBER_EXPR,
  REPOSITORY_ID_EXPR,
  RUNNER_ENTRY_PATH,
  RUNNER_RUN_COMMAND,
  type AllowedPullRequestEvent,
  type CiPostAsValue,
} from './constants.js';

/**
 * Pure GitHub Actions workflow generator — no I/O. Every invariant below is
 * load-bearing security, not style:
 *
 *  - `on:` is `pull_request` only (never `pull_request_target`, `issue_comment`,
 *    `pull_request_review_comment` or `workflow_run`), with `types` filtered to
 *    the three allowed values.
 *  - `permissions:` is top-level and EXACTLY `contents: read` +
 *    `pull-requests: write`; there are no job-level permissions.
 *  - The keyed job runs only when the head repo is the base repo, so fork PRs
 *    never receive a secret.
 *  - The checkout is the PR BASE sha, never the head: the job runs code that is
 *    already on the base branch (`.devdigest/runner/`), so a PR cannot change
 *    what executes with the secrets. A guard step skips the run (exit 0) while
 *    the runner is not yet on base — i.e. while the install PR itself is open.
 *  - Every `uses:` is pinned to a full commit SHA.
 *  - Secrets appear only as the two exact expressions, only in the review
 *    step's `env:`. No `run:` contains `${{ … }}`; the review `run:` is the one
 *    fixed command.
 *  - The artifact upload keeps `always()` so a failing-gate run (non-zero exit)
 *    is still uploaded for pull-based ingest.
 */

export interface GhaWorkflowOptions {
  /** Requested trigger types; filtered to the whitelist (defense in depth). */
  triggers?: readonly string[];
  /** Requested `post_as`; whitelist-filtered, falling back to `github_review`. */
  postAs?: string;
}

/** Whitelist-filter + de-dupe requested triggers, in canonical order. */
export function normalizeTriggers(triggers: readonly string[] | undefined): AllowedPullRequestEvent[] {
  const requested = triggers && triggers.length > 0 ? triggers : DEFAULT_PULL_REQUEST_EVENTS;
  const requestedSet = new Set(requested);
  const filtered = ALLOWED_PULL_REQUEST_EVENTS.filter((event) => requestedSet.has(event));
  return filtered.length > 0 ? filtered : [...DEFAULT_PULL_REQUEST_EVENTS];
}

function normalizePostAs(postAs: string | undefined): CiPostAsValue {
  return (POST_AS_VALUES as readonly string[]).includes(postAs ?? '')
    ? (postAs as CiPostAsValue)
    : DEFAULT_POST_AS;
}

function buildPermissionsBlock(): string {
  return GHA_PERMISSIONS.map(([key, value]) => `  ${key}: ${value}`).join('\n');
}

/** Generate the workflow YAML. See the module comment for the invariants. */
export function buildGhaWorkflowYaml(options: GhaWorkflowOptions = {}): string {
  const triggers = normalizeTriggers(options.triggers);
  const postAs = normalizePostAs(options.postAs);
  const present = "steps.guard.outputs.present == 'true'";

  return `name: DevDigest Review

on:
  pull_request:
    types: [${triggers.join(', ')}]

permissions:
${buildPermissionsBlock()}

jobs:
  review:
    name: DevDigest Review
    runs-on: ubuntu-latest
    # Fork PRs never receive the secrets: this job does not run for them. The
    # workflow uses the plain 'pull_request' event, never a variant that runs
    # with base-repo secrets against untrusted fork code.
    if: ${FORK_GATE_CONDITION}
    steps:
      # The BASE commit, not the PR head: the runner executed with the secrets
      # is the one already merged into the base branch.
      - name: Checkout base
        uses: ${PIN.checkout}
        with:
          ref: ${PR_BASE_SHA_EXPR}

      - name: Check the runner is installed on base
        id: guard
        shell: bash
        run: |
          if [ -f ${RUNNER_ENTRY_PATH} ]; then echo "present=true" >> "$GITHUB_OUTPUT"; else echo "::notice::DevDigest is not installed on the base branch yet; skipping review"; echo "present=false" >> "$GITHUB_OUTPUT"; fi

      - name: Setup Node.js
        if: ${present}
        uses: ${PIN.setupNode}
        with:
          node-version: '22'

      - name: Run DevDigest review
        if: ${present}
        env:
          ${ENV_OPENROUTER_API_KEY}: ${OPENROUTER_SECRET_EXPR}
          ${ENV_GITHUB_TOKEN}: ${GITHUB_TOKEN_SECRET_EXPR}
          ${ENV_GITHUB_REPOSITORY}: ${GITHUB_REPOSITORY_EXPR}
          ${ENV_PR_NUMBER}: ${PR_NUMBER_EXPR}
          ${ENV_COMMIT_SHA}: ${PR_HEAD_SHA_EXPR}
          ${ENV_REPOSITORY_ID}: ${REPOSITORY_ID_EXPR}
          ${ENV_POST_AS}: ${postAs}
        run: ${RUNNER_RUN_COMMAND}

      - name: Upload review result artifact
        if: always() && ${present}
        uses: ${PIN.uploadArtifact}
        with:
          name: ${CI_RESULT_ARTIFACT_NAME}
          path: ${CI_RESULT_FILE_NAME}
`;
}

/** The workflow as an installable, editable `CiFile`. */
export function buildGhaWorkflowFile(options: GhaWorkflowOptions = {}): CiFile {
  return { path: GHA_WORKFLOW_PATH, contents: buildGhaWorkflowYaml(options), editable: true };
}
