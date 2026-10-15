import { describe, it, expect, beforeEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import type { CiResultArtifact, RepoRef, WorkflowRunSummary } from '@devdigest/shared';
import { Container } from '../src/platform/container.js';
import type { AppConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { CiService } from '../src/modules/ci/service.js';
import { CiInstallationRepository } from '../src/modules/ci/repository/ci-installation.repo.js';
import type { GhaInstallationForIngest } from '../src/modules/ci/repository/ci-installation.repo.js';
import { CiRunRepository } from '../src/modules/ci/repository/ci-run.repo.js';
import type { CiRunInsert, CiRunRecord } from '../src/modules/ci/helpers.js';
import { CI_RESULT_ARTIFACT_NAME, CI_RESULT_FILE_NAME } from '../src/modules/ci/constants.js';

/**
 * Ingest-rejection tests (spec 0022: AC-48..AC-51, AC-80, AC-92 ingest half).
 * Hermetic: no Postgres, no network.
 *
 *  - The GitHub client is a real `MockGitHubClient` subclass whose two Actions
 *    methods are driven by the test (a `Map` of run id -> zip bytes).
 *  - Zips are real (`fflate.zipSync`) and read by the real `FflateArchiveReader`
 *    the container builds, so "not a zip" / "zip without the entry" are genuine.
 *  - `Container` and both CI repositories are REAL instances: the container
 *    through its `overrides` (+ a one-getter subclass), the repositories with
 *    only the methods `refresh()`/`listRuns()` call reassigned. No
 *    `as unknown as` cast hides a method the service starts to call
 *    (server/INSIGHTS.md 2026-09-18 and 2026-09-28).
 */

const UNUSED_DB = null as unknown as Db;

function testConfig(): AppConfig {
  return {
    databaseUrl: 'postgres://unused',
    apiPort: 0,
    apiHost: '127.0.0.1',
    webPort: 0,
    cloneDir: '/tmp/unused',
    secretsPath: '/tmp/unused-secrets.json',
    nodeEnv: 'test',
    logLevel: 'silent',
    webOrigin: 'http://localhost:0',
    embeddingsEnabled: false,
    repoIntelEnabled: true,
    promptLogVerbose: false,
    promptLogVerboseIgnored: false,
    promptLogEnabled: false,
  };
}

const WORKSPACE = 'ws-1';
const REPO = 'acme/widgets';
const REPOSITORY_ID = 123456789;
const HEAD_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const AGENT_NAME = 'Security Reviewer';

const INSTALLATION: GhaInstallationForIngest = {
  id: 'inst-1',
  agentId: 'agent-1',
  agentName: AGENT_NAME,
  repo: REPO,
  repositoryId: REPOSITORY_ID,
};

function run(id: number, over: Partial<WorkflowRunSummary> = {}): WorkflowRunSummary {
  return {
    id,
    headSha: HEAD_SHA,
    htmlUrl: `https://github.com/${REPO}/actions/runs/${id}`,
    updatedAt: '2026-10-15T10:00:00Z',
    prNumber: 42,
    ...over,
  };
}

function entry(over: Partial<CiResultArtifact> = {}): CiResultArtifact {
  return {
    status: 'ok',
    error: null,
    agent: AGENT_NAME,
    findings_count: 3,
    critical: 1,
    warning: 1,
    suggestion: 1,
    blockers: 1,
    gate_triggered: true,
    cost_usd: 0.0123,
    duration_ms: 4500,
    version: '1',
    pr_number: 42,
    commit_sha: HEAD_SHA,
    repository_id: REPOSITORY_ID,
    ...over,
  };
}

function zipOf(json: string, name: string = CI_RESULT_FILE_NAME): Uint8Array {
  return zipSync({ [name]: strToU8(json) });
}

const zipOfEntries = (entries: unknown[]): Uint8Array => zipOf(JSON.stringify(entries));

/** What the fake Actions API serves. */
class FakeActions extends MockGitHubClient {
  runs: WorkflowRunSummary[] = [];
  /** run id -> zip bytes, `null` (expired/absent) or an Error to throw. */
  artifacts = new Map<number, Uint8Array | null | Error>();
  listFailure: Error | null = null;
  readonly downloads: { runId: number; name: string }[] = [];

  override async listWorkflowRuns(): Promise<WorkflowRunSummary[]> {
    if (this.listFailure) throw this.listFailure;
    return this.runs;
  }

  override async downloadArtifact(
    _repo: RepoRef,
    opts: { runId: number; name: string },
  ): Promise<Uint8Array | null> {
    this.downloads.push(opts);
    const served = this.artifacts.get(opts.runId);
    if (served instanceof Error) throw served;
    return served ?? null;
  }
}

/** Real Container; the only subclass hook counts reads of `agentsRepo` (see AC-80). */
class TestContainer extends Container {
  agentsRepoReads = 0;
  constructor(github: MockGitHubClient) {
    super(testConfig(), UNUSED_DB, { github });
  }
  override get agentsRepo(): AgentsRepository {
    this.agentsRepoReads += 1;
    return new AgentsRepository(UNUSED_DB);
  }
}

interface Harness {
  github: FakeActions;
  container: TestContainer;
  service: CiService;
  inserts: CiRunInsert[];
  statusWrites: { id: string; status: string }[];
}

function harness(installations: GhaInstallationForIngest[] = [INSTALLATION]): Harness {
  const github = new FakeActions();
  const container = new TestContainer(github);

  const inserts: CiRunInsert[] = [];
  const statusWrites: { id: string; status: string }[] = [];

  const installationRepo = new CiInstallationRepository(UNUSED_DB);
  installationRepo.listGhaByWorkspace = async () => installations;
  installationRepo.setStatus = async (id, status) => {
    statusWrites.push({ id, status });
  };

  const runRepo = new CiRunRepository(UNUSED_DB);
  // In-memory twin of the (installation, Actions run id) unique index.
  runRepo.insertIfAbsent = async (v) => {
    if (inserts.some((i) => i.ciInstallationId === v.ciInstallationId && i.actionsRunId === v.actionsRunId)) {
      return false;
    }
    inserts.push(v);
    return true;
  };
  // The repository joins the agent name and converts cost; mirror just that here.
  runRepo.listCiRuns = async (): Promise<CiRunRecord[]> =>
    inserts.map((v, i) => ({
      id: `run-${i}`,
      agentId: v.agentId,
      agentName: AGENT_NAME,
      ciInstallationId: v.ciInstallationId,
      repo: v.repo,
      externalPrNumber: v.externalPrNumber,
      commitSha: v.commitSha,
      actionsRunId: v.actionsRunId,
      jobUrl: v.jobUrl,
      ciGateTriggered: v.ciGateTriggered,
      status: v.status,
      error: v.error,
      findingsCount: v.findingsCount,
      costUsd: v.costUsd,
      durationMs: v.durationMs,
      ranAt: v.ranAt,
    }));

  const service = new CiService(container, { installations: installationRepo, runs: runRepo });
  return { github, container, service, inserts, statusWrites };
}

describe('CiService.refresh -- ingest rejection', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('positive control (AC-51): a matching entry writes exactly one row carrying the run and entry fields, and marks the installation active', async () => {
    h.github.runs = [run(1001)];
    h.github.artifacts.set(1001, zipOfEntries([entry()]));

    const result = await h.service.refresh(WORKSPACE);

    expect(result).toEqual({ degraded: false, message: null, ingested: 1, skipped: 0 });
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).toMatchObject({
      workspaceId: WORKSPACE,
      agentId: 'agent-1',
      ciInstallationId: 'inst-1',
      repo: REPO,
      externalPrNumber: 42,
      commitSha: HEAD_SHA,
      actionsRunId: 1001,
      jobUrl: `https://github.com/${REPO}/actions/runs/1001`, // the run's html_url, not anything from the artifact
      findingsCount: 3,
      durationMs: 4500,
      costUsd: 0.0123,
      status: 'done',
      error: null,
    });
    expect(h.statusWrites).toEqual([{ id: 'inst-1', status: 'active' }]);
    expect(h.github.downloads).toEqual([{ runId: 1001, name: CI_RESULT_ARTIFACT_NAME }]);
  });

  it('AC-48: an entry whose commit_sha differs from the run head_sha writes no row and skipped is 1', async () => {
    h.github.runs = [run(1001)];
    h.github.artifacts.set(1001, zipOfEntries([entry({ commit_sha: OTHER_SHA })]));

    const result = await h.service.refresh(WORKSPACE);

    expect(h.inserts).toEqual([]);
    expect(result.skipped).toBe(1);
    expect(result.ingested).toBe(0);
    expect(h.statusWrites).toEqual([]);
  });

  it('AC-49: an entry whose repository_id differs from the installation writes no row and is counted skipped', async () => {
    h.github.runs = [run(1001)];
    h.github.artifacts.set(1001, zipOfEntries([entry({ repository_id: REPOSITORY_ID + 1 })]));

    const result = await h.service.refresh(WORKSPACE);

    expect(h.inserts).toEqual([]);
    expect(result).toMatchObject({ ingested: 0, skipped: 1 });
  });

  it('AC-50: a missing artifact, a download failure, a non-zip, a zip without the entry, invalid JSON and a schema-failing entry are each skipped, while a valid run in the same refresh is still ingested', async () => {
    const goodEntry = entry();
    h.github.runs = [run(1), run(2), run(3), run(4), run(5), run(6), run(7), run(8)];
    h.github.artifacts.set(1, null); // expired or absent
    h.github.artifacts.set(2, new Error('GitHub 410 Gone')); // download failure
    h.github.artifacts.set(3, strToU8('this is not a zip archive')); // non-zip
    h.github.artifacts.set(4, zipOf(JSON.stringify([goodEntry]), 'something-else.json')); // zip without the entry
    h.github.artifacts.set(5, zipOf('{ not json')); // invalid JSON
    h.github.artifacts.set(6, zipOfEntries([{ ...goodEntry, commit_sha: 'abc' }])); // fails the contract (short SHA)
    h.github.artifacts.set(7, zipOf(JSON.stringify(goodEntry))); // valid object, but not the required array
    h.github.artifacts.set(8, zipOfEntries([goodEntry])); // the one good run, LAST: skips must not stop the loop

    const result = await h.service.refresh(WORKSPACE);

    expect(result).toEqual({ degraded: false, message: null, ingested: 1, skipped: 7 });
    expect(h.inserts.map((i) => i.actionsRunId)).toEqual([8]);
  });

  it('AC-50: a schema-failing element rejects the whole run, including entries that were individually valid', async () => {
    h.github.runs = [run(1)];
    h.github.artifacts.set(1, zipOfEntries([entry(), { ...entry(), blockers: undefined }]));

    const result = await h.service.refresh(WORKSPACE);

    expect(h.inserts).toEqual([]);
    expect(result).toMatchObject({ ingested: 0, skipped: 1 });
  });

  it('a foreign-agent entry is ignored silently BEFORE the SHA and repo checks: it is never counted in skipped, even with a wrong SHA (plan behaviour of classifyArtifactEntry)', async () => {
    h.github.runs = [run(1001)];
    h.github.artifacts.set(
      1001,
      zipOfEntries([
        entry({ agent: 'Some Other Agent', commit_sha: OTHER_SHA }), // wrong agent AND wrong SHA
        entry({ agent: 'Some Other Agent', repository_id: 7 }), // wrong agent AND wrong repo
        entry({ agent: null, commit_sha: OTHER_SHA }), // no-manifest error entry shape
        entry(), // ours
      ]),
    );

    const result = await h.service.refresh(WORKSPACE);

    expect(result).toEqual({ degraded: false, message: null, ingested: 1, skipped: 0 });
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]!.agentId).toBe('agent-1');
  });

  it('the shared artifact array is split per installation: our entry is taken, a sibling agent entry for the same run is left to its own installation', async () => {
    const sibling: GhaInstallationForIngest = { ...INSTALLATION, id: 'inst-2', agentId: 'agent-2', agentName: 'General Reviewer' };
    const two = harness([INSTALLATION, sibling]);
    two.github.runs = [run(1001)];
    two.github.artifacts.set(
      1001,
      zipOfEntries([entry({ findings_count: 3 }), entry({ agent: 'General Reviewer', findings_count: 9, blockers: 0, gate_triggered: false })]),
    );

    const result = await two.service.refresh(WORKSPACE);

    expect(result).toMatchObject({ ingested: 2, skipped: 0 });
    expect(two.inserts.map((i) => [i.ciInstallationId, i.findingsCount])).toEqual([
      ['inst-1', 3],
      ['inst-2', 9],
    ]);
  });

  it('a refresh with no installation makes no GitHub call and returns zeros', async () => {
    const empty = harness([]);
    empty.github.runs = [run(1)];
    const result = await empty.service.refresh(WORKSPACE);
    expect(result).toEqual({ degraded: false, message: null, ingested: 0, skipped: 0 });
    expect(empty.github.downloads).toEqual([]);
  });

  it('failure listing runs marks the refresh degraded with the repo and message, and does not touch the rows', async () => {
    h.github.listFailure = new Error('GitHub is down');
    const result = await h.service.refresh(WORKSPACE);
    expect(result.degraded).toBe(true);
    expect(result.message).toContain(REPO);
    expect(result.message).toContain('GitHub is down');
    expect(h.inserts).toEqual([]);
  });
});

describe('CiService -- verdict comes from the runner gate (AC-80)', () => {
  it('gate_triggered: true lists as request_changes regardless of the current ci_fail_on of the agent (a "never" agent is never even loaded)', async () => {
    const h = harness();
    h.github.runs = [run(1001)];
    h.github.artifacts.set(1001, zipOfEntries([entry({ blockers: 2, gate_triggered: true })]));

    await h.service.refresh(WORKSPACE);
    const runs = await h.service.listRuns(WORKSPACE);

    expect(h.inserts[0]).toMatchObject({ blockers: 2, ciGateTriggered: true });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.verdict).toBe('request_changes');
    // The agent row (which carries the current ci_fail_on) is not loaded at all on this path;
    // the stubbed installation row has no gate field, so the verdict can only come from the entry.
    expect(h.container.agentsRepoReads).toBe(0);
  });

  it('gate_triggered: false lists as approve regardless of the current ci_fail_on of the agent (an "any" agent is never even loaded)', async () => {
    const h = harness();
    h.github.runs = [run(1001)];
    h.github.artifacts.set(1001, zipOfEntries([entry({ blockers: 0, gate_triggered: false, findings_count: 4, critical: 0 })]));

    await h.service.refresh(WORKSPACE);
    const runs = await h.service.listRuns(WORKSPACE);

    expect(h.inserts[0]).toMatchObject({ blockers: 0, ciGateTriggered: false, findingsCount: 4 });
    expect(runs[0]!.verdict).toBe('approve');
    expect(h.container.agentsRepoReads).toBe(0);
  });
});

describe('CiService.refresh -- error entries (AC-92 ingest half)', () => {
  const errorEntry = (over: Partial<CiResultArtifact> = {}): CiResultArtifact =>
    entry({
      status: 'error',
      error: 'upstream 500',
      findings_count: 0,
      critical: 0,
      warning: 0,
      suggestion: 0,
      blockers: 0,
      gate_triggered: false,
      cost_usd: null,
      duration_ms: null,
      ...over,
    });

  it('an error entry with the matching SHA and repository id writes one failed row carrying the error text', async () => {
    const h = harness();
    h.github.runs = [run(1001)];
    h.github.artifacts.set(1001, zipOfEntries([errorEntry()]));

    const result = await h.service.refresh(WORKSPACE);
    const runs = await h.service.listRuns(WORKSPACE);

    expect(result).toMatchObject({ ingested: 1, skipped: 0 });
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).toMatchObject({ status: 'failed', error: 'upstream 500', costUsd: null, ciGateTriggered: false, blockers: 0 });
    expect(runs[0]).toMatchObject({ status: 'failed', error: 'upstream 500', verdict: 'approve', cost_usd: null });
  });

  it('the same error entry with a wrong SHA writes no row (and one with a wrong repository id writes none either)', async () => {
    const h = harness();
    h.github.runs = [run(1001), run(1002)];
    h.github.artifacts.set(1001, zipOfEntries([errorEntry({ commit_sha: OTHER_SHA })]));
    h.github.artifacts.set(1002, zipOfEntries([errorEntry({ repository_id: REPOSITORY_ID + 1 })]));

    const result = await h.service.refresh(WORKSPACE);

    expect(h.inserts).toEqual([]);
    expect(result).toMatchObject({ ingested: 0, skipped: 2 });
    expect(h.statusWrites).toEqual([]);
  });

  it('an error entry without an error text still stores a non-empty failure message', async () => {
    const h = harness();
    h.github.runs = [run(1001)];
    h.github.artifacts.set(1001, zipOfEntries([errorEntry({ error: null })]));

    await h.service.refresh(WORKSPACE);

    expect(h.inserts[0]).toMatchObject({ status: 'failed' });
    expect(h.inserts[0]!.error).toBeTruthy();
  });
});
