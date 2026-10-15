import type { Finding } from '@devdigest/shared';
import { CiResultArtifact } from '@devdigest/shared';
import { RunnerError } from './errors.js';
import { resolveCiIdentity, type CiEnv } from './context.js';

/** Runner version string embedded in every artifact (informational only). */
export const RUNNER_VERSION = '1';

export interface BuildResultArtifactInput {
  findings: Finding[];
  costUsd: number | null;
  durationMs: number;
  agent: string;
  prNumber: number;
  blockers: number;
  gateTriggered: boolean;
  commitSha: string;
  repositoryId: number;
}

/** Max length of the `error` field (matches the `CiResultArtifact` contract). */
export const MAX_ERROR_LENGTH = 500;
const REDACTED = '***';
const SECRET_ENV_KEYS = ['OPENROUTER_API_KEY', 'GITHUB_TOKEN'] as const;

/** Replace every non-empty secret value found in `env` with `***`. */
export function redactSecrets(text: string, env: Record<string, string | undefined>): string {
  const secrets = SECRET_ENV_KEYS.map((k) => env[k])
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    // longest first, so a secret that contains another is fully masked
    .sort((a, b) => b.length - a.length);
  let out = text;
  for (const secret of secrets) out = out.split(secret).join(REDACTED);
  return out;
}

function severityCounts(findings: Finding[]): { critical: number; warning: number; suggestion: number } {
  const counts = { critical: 0, warning: 0, suggestion: 0 };
  for (const f of findings) {
    if (f.severity === 'CRITICAL') counts.critical++;
    else if (f.severity === 'WARNING') counts.warning++;
    else counts.suggestion++;
  }
  return counts;
}

/**
 * Build + validate the `devdigest-result.json` artifact (AC-26). Validated
 * against the SAME `CiResultArtifact` Zod contract the studio's ingest path
 * (T6) will `safeParse` on the way back in, so a malformed artifact fails
 * loudly here rather than silently on ingest.
 */
export function buildResultArtifact(input: BuildResultArtifactInput): CiResultArtifact {
  const counts = severityCounts(input.findings);
  const candidate = {
    status: 'ok' as const,
    error: null,
    blockers: input.blockers,
    gate_triggered: input.gateTriggered,
    commit_sha: input.commitSha,
    repository_id: input.repositoryId,
    findings_count: input.findings.length,
    critical: counts.critical,
    warning: counts.warning,
    suggestion: counts.suggestion,
    cost_usd: input.costUsd,
    duration_ms: input.durationMs,
    agent: input.agent,
    version: RUNNER_VERSION,
    pr_number: input.prNumber,
  };
  const result = CiResultArtifact.safeParse(candidate);
  if (!result.success) {
    // Should be unreachable — every field above is shaped to the schema. If
    // this ever fires it's a genuine internal bug, not a user/config error.
    throw new RunnerError(
      `Internal error: built result artifact failed CiResultArtifact validation: ${result.error.message}`,
    );
  }
  return result.data;
}

/**
 * Build the artifact written on a hard failure: one `status: "error"` entry per
 * manifest name, or a single `agent: null` entry when `agents` is null (no
 * manifest existed). The message is redacted of both secrets BEFORE it is
 * truncated to 500 chars, so a secret cut in half can never survive. Counts are
 * zero and the gate is false: an error entry never blocks a merge by itself.
 */
export function buildErrorArtifacts(
  agents: string[] | null,
  message: string,
  env: CiEnv,
  prNumber?: number,
): CiResultArtifact[] {
  const identity = resolveCiIdentity(env);
  const error = redactSecrets(message, env).slice(0, MAX_ERROR_LENGTH);
  const names: (string | null)[] = agents ?? [null];
  return names.map((agent) => {
    const result = CiResultArtifact.safeParse({
      status: 'error',
      error,
      agent,
      findings_count: 0,
      critical: 0,
      warning: 0,
      suggestion: 0,
      blockers: 0,
      gate_triggered: false,
      cost_usd: null,
      duration_ms: null,
      version: RUNNER_VERSION,
      pr_number: prNumber ?? null,
      commit_sha: identity.commitSha,
      repository_id: identity.repositoryId,
    });
    if (!result.success) {
      throw new RunnerError(
        `Internal error: built error artifact failed CiResultArtifact validation: ${result.error.message}`,
      );
    }
    return result.data;
  });
}
