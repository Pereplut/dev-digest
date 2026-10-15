import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { CiResultArtifact } from '@devdigest/shared';
import type {
  CiExport,
  CiExportInput,
  CiFile,
  CiInstallation,
  CiRefreshResult,
  CiRun,
  CiUpdateResult,
  GitHubClient,
  RepoRef,
  WorkflowRunSummary,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { AgentRow } from '../../db/rows.js';
import {
  AppError,
  ExternalServiceError,
  NotFoundError,
  ValidationError,
} from '../../platform/errors.js';
import {
  CI_BRANCH,
  CI_RESULT_ARTIFACT_NAME,
  CI_RESULT_FILE_NAME,
  DEFAULT_RUNNER_DIST_DIR,
  GHA_WORKFLOW_FILE,
  MAX_ARTIFACT_JSON_BYTES,
  MAX_RUNS_PER_REFRESH,
  RUNNER_DIR,
} from './constants.js';
import {
  buildCiFileSet,
  classifyArtifactEntry,
  parseRepoSlug,
  toAgentRunInsert,
  toCiInstallationDto,
  toCiRunDto,
  type IngestInstallation,
} from './helpers.js';
import { normalizeTriggers } from './workflow.js';
import { CiInstallationRepository } from './repository/ci-installation.repo.js';
import { CiRunRepository } from './repository/ci-run.repo.js';

const RUNNER_BUNDLE_MISSING = 'Runner bundle not built — run: cd agent-runner && npm run build';

/**
 * Read EVERY file the ncc bundle emitted (`agent-runner/dist/`) as `CiFile`s
 * under `.devdigest/runner/`. ncc splits dynamic imports into extra chunk files
 * that `index.js` loads relative to itself (today `382.index.js`), so shipping
 * only `index.js` breaks the runner — and no chunk name is hardcoded here.
 * Fails loudly (never a silently incomplete export) when the directory or its
 * `index.js` is missing.
 */
export function readRunnerBundle(distDir: string): CiFile[] {
  let relativePaths: string[];
  try {
    relativePaths = (readdirSync(distDir, { recursive: true }) as string[])
      .filter((entry) => lstatSync(join(distDir, entry)).isFile())
      .map((entry) => entry.split(sep).join('/'))
      .sort();
  } catch {
    throw new AppError('runner_bundle_missing', RUNNER_BUNDLE_MISSING, 500);
  }
  if (!relativePaths.includes('index.js')) {
    throw new AppError('runner_bundle_missing', RUNNER_BUNDLE_MISSING, 500);
  }
  return relativePaths.map((rel) => ({
    path: `${RUNNER_DIR}/${rel}`,
    contents: readFileSync(join(distDir, rel), 'utf8'),
    editable: false,
  }));
}

export interface CiServiceOptions {
  /** Where the runner bundle is read from; tests point this at a temp dir. */
  runnerDistDir?: string;
  installations?: CiInstallationRepository;
  runs?: CiRunRepository;
}

interface PublishParams {
  repo: string;
  repoRef: RepoRef;
  triggers: readonly string[];
  postAs: CiExportInput['post_as'];
  workflowOverride?: string | undefined;
}

interface ExportMaterial {
  agent: AgentRow;
  skills: { name: string; body: string }[];
  runnerFiles: CiFile[];
}

const errorMessage = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : 'Unknown error';

/**
 * `ci` module — Export to CI. Assembles the `.devdigest/` file set for an
 * agent, commits it to `devdigest/ci` and opens (or reuses) a PR; and pulls
 * the runner's result artifacts back into `agent_runs` on refresh. There is no
 * inbound push endpoint: results only arrive by this server polling GitHub.
 */
export class CiService {
  private readonly installations: CiInstallationRepository;
  private readonly runs: CiRunRepository;
  private readonly runnerDistDir: string;

  constructor(
    private readonly container: Container,
    opts: CiServiceOptions = {},
  ) {
    this.installations = opts.installations ?? new CiInstallationRepository(container.db);
    this.runs = opts.runs ?? new CiRunRepository(container.db);
    this.runnerDistDir = opts.runnerDistDir ?? DEFAULT_RUNNER_DIST_DIR;
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  async exportCi(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiExport> {
    if (input.target !== 'gha') {
      throw new ValidationError('Only the GitHub Actions target is supported');
    }
    const repoRef = parseRepoSlug(input.repo);
    if (!repoRef) throw new ValidationError('repo must be "owner/name"');

    // The bundle is read BEFORE any GitHub call: a missing build must fail
    // without a single write to the target repo.
    const material = await this.loadMaterial(workspaceId, agentId);
    const params: PublishParams = {
      repo: input.repo,
      repoRef,
      triggers: input.triggers,
      postAs: input.post_as,
      workflowOverride: input.workflow_override,
    };
    const files = this.buildFiles(material, params);

    if (input.action === 'files') return { installation: null, files, pr_url: null };

    const { installation, prUrl } = await this.publish(agentId, params, files);
    return { installation, files, pr_url: prUrl };
  }

  /**
   * Re-export every GHA installation of the agent with its stored settings. The
   * workflow is regenerated, so any hand edit to it is discarded. One failure
   * does not stop the others.
   */
  async updateAll(workspaceId: string, agentId: string): Promise<CiUpdateResult> {
    const material = await this.loadMaterial(workspaceId, agentId);
    const rows = (await this.installations.listByAgent(agentId)).filter(
      (r) => r.targetType === 'gha',
    );

    const results: CiUpdateResult['results'] = [];
    for (const row of rows) {
      try {
        const repoRef = parseRepoSlug(row.repo);
        if (!repoRef) throw new ValidationError('repo must be "owner/name"');
        const params: PublishParams = {
          repo: row.repo,
          repoRef,
          triggers: row.triggers,
          postAs: row.postAs,
        };
        const { prUrl } = await this.publish(agentId, params, this.buildFiles(material, params));
        results.push({ installation_id: row.id, ok: true, pr_url: prUrl, error: null });
      } catch (err) {
        results.push({
          installation_id: row.id,
          ok: false,
          pr_url: null,
          error: errorMessage(err),
        });
      }
    }
    return { results };
  }

  private async loadMaterial(workspaceId: string, agentId: string): Promise<ExportMaterial> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const skills = await this.container.skillsRepo.enabledForAgent(workspaceId, agentId);
    const runnerFiles = readRunnerBundle(this.runnerDistDir);
    return { agent, skills, runnerFiles };
  }

  private buildFiles(material: ExportMaterial, params: PublishParams): CiFile[] {
    return buildCiFileSet(material.agent, material.skills, material.runnerFiles, {
      triggers: params.triggers,
      postAs: params.postAs,
      workflowOverride: params.workflowOverride,
    });
  }

  /**
   * Commit the file set to `devdigest/ci`, open the PR when none is open, then
   * upsert the installation row — only AFTER every GitHub call succeeded. A
   * failure marks an existing row `error` and surfaces GitHub's message.
   */
  private async publish(
    agentId: string,
    params: PublishParams,
    files: CiFile[],
  ): Promise<{ installation: CiInstallation; prUrl: string }> {
    const github = await this.container.github();
    let repositoryId: number;
    let prUrl: string;
    try {
      const repository = await github.getRepository(params.repoRef);
      repositoryId = repository.id;
      const open = await github.findOpenPr(params.repoRef, CI_BRANCH);
      await github.commitFiles(params.repoRef, {
        branch: CI_BRANCH,
        base: repository.defaultBranch,
        message: 'Add/update DevDigest CI review workflow',
        files: files.map((f) => ({ path: f.path, contents: f.contents })),
        // No open PR: a stale branch is reset to the default head, not fast-forwarded.
        resetToBase: !open,
      });
      prUrl = open
        ? open.url
        : (
            await github.openPullRequest(params.repoRef, {
              title: 'Add DevDigest CI review',
              head: CI_BRANCH,
              base: repository.defaultBranch,
              body: 'Installs the DevDigest agent and CI workflow generated by Export to CI.',
            })
          ).url;
    } catch (err) {
      const existing = await this.installations.getByAgentRepo(agentId, params.repo);
      if (existing) await this.installations.setStatus(existing.id, 'error');
      throw new ExternalServiceError(errorMessage(err));
    }

    const row = await this.installations.upsertOnExport({
      agentId,
      repo: params.repo,
      repositoryId,
      triggers: normalizeTriggers(params.triggers),
      postAs: params.postAs,
      prUrl,
    });
    const newest = await this.runs.newestByInstallation([row.id]);
    const last = newest.get(row.id);
    return { installation: toCiInstallationDto(row, last ? toCiRunDto(last) : null), prUrl };
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async listInstallations(workspaceId: string, agentId: string): Promise<CiInstallation[]> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const rows = await this.installations.listByAgent(agentId);
    const newest = await this.runs.newestByInstallation(rows.map((r) => r.id));
    return rows.map((row) => {
      const last = newest.get(row.id);
      return toCiInstallationDto(row, last ? toCiRunDto(last) : null);
    });
  }

  async listRuns(workspaceId: string, agentId?: string): Promise<CiRun[]> {
    const records = await this.runs.listCiRuns(workspaceId, agentId);
    return records.map(toCiRunDto);
  }

  // -------------------------------------------------------------------------
  // Refresh (pull-based ingest)
  // -------------------------------------------------------------------------

  /**
   * Poll every GHA installation of the workspace for completed workflow runs
   * and persist the runner's result entries as `agent_runs`. A failure listing
   * an installation's runs marks the refresh `degraded` and moves on; a bad
   * artifact only skips that run. An entry is trusted only when it names the
   * run's own head SHA and the installation's repository id.
   */
  async refresh(workspaceId: string): Promise<CiRefreshResult> {
    const installations = await this.installations.listGhaByWorkspace(workspaceId);
    const result: CiRefreshResult = { degraded: false, message: null, ingested: 0, skipped: 0 };
    if (installations.length === 0) return result;

    const github = await this.container.github();
    const messages: string[] = [];

    for (const installation of installations) {
      const repoRef = parseRepoSlug(installation.repo);
      if (!repoRef) continue;

      let runs: WorkflowRunSummary[];
      try {
        runs = await github.listWorkflowRuns(repoRef, {
          workflowFile: GHA_WORKFLOW_FILE,
          status: 'completed',
          perPage: MAX_RUNS_PER_REFRESH,
        });
      } catch (err) {
        result.degraded = true;
        messages.push(`${installation.repo}: ${errorMessage(err)}`);
        continue;
      }

      for (const run of runs.slice(0, MAX_RUNS_PER_REFRESH)) {
        const entries = await this.readArtifact(github, repoRef, run);
        if (!entries) {
          result.skipped += 1;
          continue;
        }
        await this.ingestEntries(workspaceId, installation, run, entries, result);
      }
    }

    result.message = messages.length > 0 ? messages.join('; ') : null;
    return result;
  }

  /** The run's validated artifact entries, or `null` for any unusable artifact. */
  private async readArtifact(
    github: GitHubClient,
    repoRef: RepoRef,
    run: WorkflowRunSummary,
  ): Promise<CiResultArtifact[] | null> {
    try {
      const zip = await github.downloadArtifact(repoRef, {
        runId: run.id,
        name: CI_RESULT_ARTIFACT_NAME,
      });
      if (!zip) return null;
      const bytes = this.container.archiveReader.read(
        zip,
        CI_RESULT_FILE_NAME,
        MAX_ARTIFACT_JSON_BYTES,
      );
      const parsed = CiResultArtifact.array().safeParse(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
      return parsed.success ? parsed.data : null;
    } catch {
      // Download failure, non-zip, missing entry, oversize, non-JSON: skip the run.
      return null;
    }
  }

  private async ingestEntries(
    workspaceId: string,
    installation: IngestInstallation,
    run: WorkflowRunSummary,
    entries: CiResultArtifact[],
    result: CiRefreshResult,
  ): Promise<void> {
    for (const entry of entries) {
      const verdict = classifyArtifactEntry(entry, run, installation);
      if (verdict === 'other_agent') continue;
      if (verdict !== 'ok') {
        result.skipped += 1;
        continue;
      }
      const inserted = await this.runs.insertIfAbsent(
        toAgentRunInsert(entry, run, installation, workspaceId),
      );
      if (inserted) {
        result.ingested += 1;
        await this.installations.setStatus(installation.id, 'active');
      }
    }
  }
}
