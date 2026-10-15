import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { LLMProvider, GitHubReviewPayload, CiResultArtifact, AgentManifest } from '@devdigest/shared';
import { reviewPullRequest, toReviewPayload, gateTriggered, countBlockers } from '@devdigest/reviewer-core';
import { findManifestPaths, loadAgentManifest } from './manifest.js';
import { loadSkillBodies } from './skills.js';
import { resolvePrContext, resolveCiIdentity, type CiEnv } from './context.js';
import { parseUnifiedDiff, stripIgnoredFiles } from './diff.js';
import { fetchPrDiff, postGithubReview, postPrComment, type FetchLike } from './github.js';
import { buildResultArtifact, buildErrorArtifacts, redactSecrets } from './artifact.js';
import { RunnerError } from './errors.js';

/**
 * `runCi` — the runner's single orchestration entry point. Mirrors the
 * pipeline a local studio review runs (assemblePrompt/wrapUntrusted →
 * completeStructured → groundFindings, all INSIDE `reviewPullRequest`) so CI
 * and local stay in parity: this file never re-implements any of that — it only
 * resolves CI-specific inputs (manifest, skills, diff, PR context) and hands
 * them to the SAME reviewer-core engine the studio calls.
 *
 * Deterministic gate: blockers + the gate come from `countBlockers`/
 * `gateTriggered` over the GROUNDED findings and the manifest's `ci_fail_on`,
 * never from `review.verdict` (the model's self-report).
 *
 * Failure phases:
 *  1. Pre-flight (env identity, manifests): any failure — invalid
 *     `DEVDIGEST_*` env, an unreadable or INVALID manifest — exits 1 before any
 *     write (AC-3). The one exception is a repo with ZERO manifests: that
 *     writes a single `agent: null` error entry (AC-92).
 *  2. Everything after manifests load (skills, PR context, diff, model): a
 *     failure exits 1, posts NOTHING and writes one `status: "error"` entry per
 *     manifest, with the message redacted of both secrets (AC-10, AC-13, AC-92).
 *     If the success artifact was already written, it is not overwritten.
 */

export type PostAs = 'github_review' | 'pr_comment' | 'none';

export interface RunCiDeps {
  /** Directory containing `agents/` and `skills/` (checked-in `.devdigest/`). */
  devdigestDir: string;
  env: CiEnv;
  /** Injected LLM provider — `OpenRouterProvider` in production, a stub in tests. */
  llm: LLMProvider;
  /** How to post the result — `'github_review' | 'pr_comment' | 'none'` (AC-24). */
  postAs: PostAs;
  /** Absolute path to write the `CiResultArtifact` JSON to. */
  resultPath: string;
  fetchImpl?: FetchLike;
  readFile?: typeof readFileSync;
  readDir?: typeof readdirSync;
  writeFile?: typeof writeFileSync;
  now?: () => number;
  /**
   * Override diff retrieval (tests supply a fixture diff directly instead of
   * hitting the GitHub API). Defaults to `fetchPrDiff` via the GitHub REST API.
   */
  fetchDiff?: (
    ctx: { owner: string; repo: string; prNumber: number },
    token: string,
    fetchImpl: FetchLike,
  ) => Promise<string>;
}

/** Per-agent outcome — one entry per manifest under `.devdigest/agents/`. */
export interface AgentRunResult {
  agent: string;
  artifact: CiResultArtifact;
  posted: { kind: PostAs; payload?: GitHubReviewPayload };
  blockers: number;
  gateTriggered: boolean;
}

export interface RunCiSuccess {
  exitCode: number;
  /** One result per reviewer, in manifest-filename order. */
  results: AgentRunResult[];
  /** The `CiResultArtifact[]` written to disk (one per reviewer). */
  artifacts: CiResultArtifact[];
  error?: undefined;
}

export interface RunCiFailure {
  exitCode: number;
  results: null;
  /** The error entries written to disk, or null when nothing was written. */
  artifacts: CiResultArtifact[] | null;
  error: string;
}

export type RunCiResult = RunCiSuccess | RunCiFailure;

export async function runCi(deps: RunCiDeps): Promise<RunCiResult> {
  const readFile = deps.readFile ?? readFileSync;
  const readDir = deps.readDir ?? readdirSync;
  const writeFile = deps.writeFile ?? writeFileSync;
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const fetchDiffImpl = deps.fetchDiff ?? fetchPrDiff;

  const write = (artifacts: CiResultArtifact[]): void =>
    writeFile(deps.resultPath, `${JSON.stringify(artifacts, null, 2)}\n`);

  // Phase 1 — pre-flight. A throw here writes nothing, except "no manifests".
  let manifests: AgentManifest[];
  try {
    resolveCiIdentity(deps.env);
    let paths: string[] | null = null;
    try {
      paths = findManifestPaths(deps.devdigestDir, { readFile, readDir });
    } catch (err) {
      return failWith(err, null);
    }
    // Validate EVERY manifest before any is used (AC-3).
    manifests = paths.map((p) => loadAgentManifest(p, { readFile, readDir }));
  } catch (err) {
    return { exitCode: 1, results: null, artifacts: null, error: messageOf(err, deps.env) };
  }

  // Phase 2 — everything after the manifests are known to be valid.
  let written = false;
  try {
    const ctx = resolvePrContext(deps.env, readFile);

    const githubToken = deps.env.GITHUB_TOKEN;
    if (deps.postAs !== 'none' && !githubToken) {
      throw new RunnerError(`GITHUB_TOKEN is required to post as '${deps.postAs}'`);
    }

    // Assemble the diff ONCE — it is the same PR diff for every reviewer.
    // Strip DevDigest's own exported artifacts (`.devdigest/**`, the generated
    // workflow) BEFORE parse: the minified runner bundle would otherwise fail
    // the whole review with a GitHub 422 "diff too large".
    const rawDiff = await fetchDiffImpl(ctx, githubToken ?? '', fetchImpl);
    const diff = parseUnifiedDiff(stripIgnoredFiles(rawDiff));

    // The title and branch names are untrusted: they go in the PR description,
    // which the engine wraps with wrapUntrusted(). `task` is appended unwrapped
    // by the prompt assembler, so it must carry only trusted text.
    const prDescription = `Title: ${ctx.title}\nBranches: ${ctx.headRef} → ${ctx.baseRef}\n\n${ctx.body}`;

    // Compute ALL reviews first (no posting yet): a failure in any one hard-fails
    // the whole run with nothing posted.
    const computed = manifests.map((manifest) => {
      const skills = loadSkillBodies(deps.devdigestDir, manifest.skills, readFile);
      const start = now();
      return reviewPullRequest({
        systemPrompt: manifest.system_prompt,
        model: manifest.model,
        diff,
        llm: deps.llm,
        strategy: manifest.strategy,
        skills,
        prDescription,
        task: `Review PR #${ctx.prNumber}`,
        // `reviewPullRequest` internally applies assemblePrompt/wrapUntrusted
        // + the mandatory groundFindings() gate.
      }).then((outcome) => ({ manifest, outcome, durationMs: now() - start }));
    });
    const reviews = await Promise.all(computed);

    // Per-agent deterministic verdict/gate from GROUNDED findings.
    const results: AgentRunResult[] = reviews.map(({ manifest, outcome, durationMs }) => {
      const blockers = countBlockers(outcome.review.findings, manifest.ci_fail_on);
      const gate = gateTriggered(outcome.review.findings, manifest.ci_fail_on);
      return {
        agent: manifest.name,
        artifact: buildResultArtifact({
          findings: outcome.review.findings,
          costUsd: outcome.costUsd,
          durationMs,
          agent: manifest.name,
          prNumber: ctx.prNumber,
          blockers,
          gateTriggered: gate,
          commitSha: ctx.commitSha,
          repositoryId: ctx.repositoryId,
        }),
        posted: {
          kind: deps.postAs,
          payload: toReviewPayload(outcome.review, {
            failOn: manifest.ci_fail_on,
            diff,
            title: manifest.name,
          }),
        },
        blockers,
        gateTriggered: gate,
      };
    });

    // Write the artifact array before posting, so a GitHub-side posting
    // failure never loses the already-computed, already-grounded results.
    const artifacts = results.map((r) => r.artifact);
    write(artifacts);
    written = true;

    for (const r of results) {
      if (deps.postAs === 'github_review') {
        await postGithubReview(ctx, githubToken as string, r.posted.payload!, fetchImpl);
      } else if (deps.postAs === 'pr_comment') {
        await postPrComment(ctx, githubToken as string, r.posted.payload!.body, fetchImpl);
      }
      // 'none' → post nothing (exit-code only).
    }

    // Exit non-zero IFF ANY reviewer's gate triggered.
    return {
      exitCode: results.some((r) => r.gateTriggered) ? 1 : 0,
      results,
      artifacts,
    };
  } catch (err) {
    return failWith(err, written ? undefined : manifests.map((m) => m.name));
  }

  /**
   * Hard-fail: non-zero exit, nothing posted. `agents`: manifest names to write
   * error entries for; `null` = no manifest existed (`agent: null` entry);
   * `undefined` = write nothing (results already on disk).
   */
  function failWith(err: unknown, agents: string[] | null | undefined): RunCiFailure {
    const error = messageOf(err, deps.env);
    let artifacts: CiResultArtifact[] | null = null;
    if (agents !== undefined) {
      try {
        artifacts = buildErrorArtifacts(agents, error, deps.env);
        write(artifacts);
      } catch {
        artifacts = null; // never mask the original failure
      }
    }
    return { exitCode: 1, results: null, artifacts, error };
  }
}

function messageOf(err: unknown, env: CiEnv): string {
  return redactSecrets(err instanceof Error ? err.message : String(err), env);
}
