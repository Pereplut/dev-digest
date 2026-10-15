import { AgentManifest, CiTrigger } from '@devdigest/shared';
import type {
  AgentManifestInput,
  CiFile,
  CiInstallation,
  CiPostAs,
  CiResultArtifact,
  CiRun,
  RepoRef,
  WorkflowRunSummary,
} from '@devdigest/shared';
import type { CiInstallationRow } from '../../db/rows.js';
import {
  agentManifestPath,
  GHA_WORKFLOW_PATH,
  MEMORY_FILE_PATH,
  skillFilePath,
} from './constants.js';
import { buildGhaWorkflowFile } from './workflow.js';

/**
 * Pure helpers for the ci module — no I/O, no SDK, no database. Slug and
 * manifest generation, the exported file set, the ingest classification and the
 * row ↔ DTO mapping live here so they unit-test without Postgres or GitHub.
 */

// ---------------------------------------------------------------------------
// Repo slug
// ---------------------------------------------------------------------------

const REPO_SLUG_PATTERN = /^[\w.-]+\/[\w.-]+$/;

/** Parse "owner/name"; `null` when it is not exactly that shape. */
export function parseRepoSlug(slug: string): RepoRef | null {
  if (!REPO_SLUG_PATTERN.test(slug)) return null;
  const [owner, name] = slug.split('/');
  return owner && name ? { owner, name } : null;
}

// ---------------------------------------------------------------------------
// Slugs — derived at export time, never persisted
// ---------------------------------------------------------------------------

/** Filesystem-safe slug shape required by the on-disk `.devdigest/` layout. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const FALLBACK_SLUG = 'agent';

/** Normalise a display name into a slug matching `SLUG_PATTERN`. Pure and stable. */
export function slugify(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (normalized.length === 0) return FALLBACK_SLUG;
  return SLUG_PATTERN.test(normalized) ? normalized : FALLBACK_SLUG;
}

/** `baseSlug` if free, else the smallest `-N` (N >= 2) suffix not in `usedSlugs`. */
export function disambiguateSlug(baseSlug: string, usedSlugs: Iterable<string>): string {
  const used = usedSlugs instanceof Set ? usedSlugs : new Set(usedSlugs);
  if (!used.has(baseSlug)) return baseSlug;
  let suffix = 2;
  let candidate = `${baseSlug}-${suffix}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${baseSlug}-${suffix}`;
  }
  return candidate;
}

/** Slugify a name and disambiguate it against already-used slugs. */
export function slugFromName(name: string, usedSlugs: Iterable<string> = []): string {
  return disambiguateSlug(slugify(name), usedSlugs);
}

// ---------------------------------------------------------------------------
// Agent manifest YAML (hand-emitted: `yaml` is a devDependency, not runtime)
// ---------------------------------------------------------------------------

/** The subset of an agent needed to build a manifest. */
export interface AgentManifestSource {
  name: string;
  provider: AgentManifestInput['provider'];
  model: string;
  systemPrompt: string;
  strategy: AgentManifestInput['strategy'];
  ciFailOn: AgentManifestInput['ci_fail_on'];
}

/** Build (and validate) an `AgentManifest` from the agent + its skill slugs. */
export function buildAgentManifest(agent: AgentManifestSource, skillSlugs: string[]): AgentManifest {
  return AgentManifest.parse({
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.systemPrompt,
    skills: skillSlugs,
    strategy: agent.strategy,
    ci_fail_on: agent.ciFailOn,
  } satisfies AgentManifestInput);
}

/** JSON string body (no quotes): a strict subset of YAML double-quoted escaping. */
function escapeScalarBody(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

function scalarLine(key: string, value: string): string {
  return `${key}: "${escapeScalarBody(value)}"`;
}

/** Deterministic YAML: every scalar double-quoted and JSON-escaped. */
export function serializeAgentManifestYaml(manifest: AgentManifest): string {
  const lines: string[] = [
    scalarLine('name', manifest.name),
    scalarLine('provider', manifest.provider),
    scalarLine('model', manifest.model),
    scalarLine('system_prompt', manifest.system_prompt),
  ];
  if (manifest.skills.length === 0) {
    lines.push('skills: []');
  } else {
    lines.push('skills:');
    for (const skill of manifest.skills) lines.push(`  - "${escapeScalarBody(skill)}"`);
  }
  lines.push(scalarLine('strategy', manifest.strategy));
  lines.push(scalarLine('ci_fail_on', manifest.ci_fail_on));
  return `${lines.join('\n')}\n`;
}

export function buildAgentManifestYaml(agent: AgentManifestSource, skillSlugs: string[]): string {
  return serializeAgentManifestYaml(buildAgentManifest(agent, skillSlugs));
}

// ---------------------------------------------------------------------------
// The exported file set
// ---------------------------------------------------------------------------

export interface CiFileSetOptions {
  triggers: readonly string[];
  postAs: CiPostAs;
  /** Replaces the generated workflow's contents byte-for-byte when non-empty. */
  workflowOverride?: string | undefined;
}

/**
 * manifest + one `.md` per enabled skill + an empty memory log + every runner
 * bundle file + the workflow. Only the workflow is editable.
 */
export function buildCiFileSet(
  agent: AgentManifestSource,
  skills: readonly { name: string; body: string }[],
  runnerFiles: readonly CiFile[],
  opts: CiFileSetOptions,
): CiFile[] {
  const usedSlugs = new Set<string>();
  const agentSlug = slugFromName(agent.name, usedSlugs);
  usedSlugs.add(agentSlug);

  const skillSlugs: string[] = [];
  const skillFiles: CiFile[] = skills.map((skill) => {
    const slug = slugFromName(skill.name, usedSlugs);
    usedSlugs.add(slug);
    skillSlugs.push(slug);
    return { path: skillFilePath(slug), contents: skill.body, editable: false };
  });

  const manifestFile: CiFile = {
    path: agentManifestPath(agentSlug),
    contents: buildAgentManifestYaml(agent, skillSlugs),
    editable: false,
  };
  const memoryFile: CiFile = { path: MEMORY_FILE_PATH, contents: '', editable: false };
  const workflow = buildGhaWorkflowFile({ triggers: opts.triggers, postAs: opts.postAs });
  if (opts.workflowOverride) workflow.contents = opts.workflowOverride;

  return [
    manifestFile,
    ...skillFiles,
    memoryFile,
    ...runnerFiles.map((f) => ({ ...f, editable: false })),
    { ...workflow, path: GHA_WORKFLOW_PATH, editable: true },
  ];
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

export interface IngestInstallation {
  id: string;
  agentId: string;
  agentName: string;
  repo: string;
  repositoryId: number;
}

export type ArtifactClass = 'sha_mismatch' | 'repo_mismatch' | 'other_agent' | 'ok';

/**
 * Decide what ingest does with one artifact entry. `other_agent` is silently
 * ignored (the workflow serves every agent exported to the repo); a SHA or
 * repository-id mismatch is a skip: an artifact is attacker-influenceable, so
 * an entry is trusted only when it names this run's own head and repository.
 */
export function classifyArtifactEntry(
  entry: CiResultArtifact,
  run: Pick<WorkflowRunSummary, 'headSha'>,
  installation: Pick<IngestInstallation, 'repositoryId' | 'agentName'>,
): ArtifactClass {
  if (entry.agent !== installation.agentName) return 'other_agent';
  if (entry.commit_sha !== run.headSha) return 'sha_mismatch';
  if (entry.repository_id !== installation.repositoryId) return 'repo_mismatch';
  return 'ok';
}

/** Values of one ingested `agent_runs` row. Cost is a number here; the repo stringifies it. */
export interface CiRunInsert {
  workspaceId: string;
  agentId: string;
  ciInstallationId: string;
  ranAt: Date;
  durationMs: number | null;
  costUsd: number | null;
  status: 'done' | 'failed';
  error: string | null;
  findingsCount: number;
  blockers: number;
  repo: string;
  externalPrNumber: number | null;
  commitSha: string;
  actionsRunId: number;
  jobUrl: string;
  ciGateTriggered: boolean;
}

/** Map an accepted artifact entry to an `agent_runs` insert (`source='ci'` is set by the repo). */
export function toAgentRunInsert(
  entry: CiResultArtifact,
  run: WorkflowRunSummary,
  installation: IngestInstallation,
  workspaceId: string,
): CiRunInsert {
  const ok = entry.status === 'ok';
  return {
    workspaceId,
    agentId: installation.agentId,
    ciInstallationId: installation.id,
    ranAt: new Date(run.updatedAt),
    durationMs: entry.duration_ms ?? null,
    costUsd: entry.cost_usd,
    status: ok ? 'done' : 'failed',
    error: ok ? null : (entry.error ?? 'CI run failed'),
    findingsCount: entry.findings_count,
    blockers: entry.blockers,
    repo: installation.repo,
    externalPrNumber: entry.pr_number ?? run.prNumber,
    commitSha: entry.commit_sha,
    actionsRunId: run.id,
    jobUrl: run.htmlUrl,
    ciGateTriggered: entry.gate_triggered,
  };
}

// ---------------------------------------------------------------------------
// Row ↔ DTO
// ---------------------------------------------------------------------------

/** One `source='ci'` agent_runs row joined to its agent's name, cost already a number. */
export interface CiRunRecord {
  id: string;
  agentId: string | null;
  agentName: string | null;
  ciInstallationId: string | null;
  repo: string | null;
  externalPrNumber: number | null;
  commitSha: string | null;
  actionsRunId: number | null;
  jobUrl: string | null;
  ciGateTriggered: boolean | null;
  status: string | null;
  error: string | null;
  findingsCount: number | null;
  costUsd: number | null;
  durationMs: number | null;
  ranAt: Date;
}

export function toCiRunDto(r: CiRunRecord): CiRun {
  return {
    id: r.id,
    agent_id: r.agentId,
    agent_name: r.agentName,
    ci_installation_id: r.ciInstallationId,
    repo: r.repo ?? '',
    pr_number: r.externalPrNumber,
    commit_sha: r.commitSha ?? '',
    actions_run_id: r.actionsRunId ?? 0,
    job_url: r.jobUrl ?? '',
    // The verdict derives from the runner's own stored gate decision, never from
    // the agent's current `ci_fail_on`.
    verdict: r.ciGateTriggered ? 'request_changes' : 'approve',
    status: r.status === 'failed' ? 'failed' : 'succeeded',
    error: r.error,
    findings_count: r.findingsCount,
    cost_usd: r.costUsd,
    duration_ms: r.durationMs,
    ran_at: r.ranAt.toISOString(),
  };
}

export function toCiInstallationDto(row: CiInstallationRow, lastRun: CiRun | null): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType,
    installed_at: row.installedAt.toISOString(),
    status: row.status,
    workflow_version: row.workflowVersion,
    triggers: row.triggers.flatMap((t) => {
      const parsed = CiTrigger.safeParse(t);
      return parsed.success ? [parsed.data] : [];
    }),
    post_as: row.postAs,
    pr_url: row.prUrl,
    last_run: lastRun,
  };
}
