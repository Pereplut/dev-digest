/**
 * ReviewRunExecutor fan-out (spec 0021, AC-6..AC-10). Hermetic: diff loading
 * and intent are mocked, `runOneAgent` (private) is replaced on the instance,
 * and the repository is a real ReviewRepository with only the writes this path
 * reaches patched (same approach as run-executor-cancel.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';
import { Container } from '../src/platform/container.js';
import { ReviewRepository, type PullRow } from '../src/modules/reviews/repository.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { ReviewRunExecutor, RunCancelledError } from '../src/modules/reviews/run-executor.js';
import type { AgentRow } from '../src/db/rows.js';
import type { Db } from '../src/db/client.js';
import type { AppConfig } from '../src/platform/config.js';
import * as schema from '../src/db/schema.js';

const loadDiffMock = vi.hoisted(() => vi.fn());
const deriveIntentMock = vi.hoisted(() => vi.fn());
vi.mock('../src/modules/reviews/diff-loader.js', () => ({ loadDiff: loadDiffMock }));
vi.mock('../src/modules/reviews/intent.js', () => ({ deriveIntent: deriveIntentMock }));

const UNUSED_DB = null as unknown as Db;
const config = {
  databaseUrl: 'postgres://unused', apiPort: 0, apiHost: '127.0.0.1', webPort: 0, cloneDir: '/tmp/unused',
  secretsPath: '/tmp/unused-secrets.json', nodeEnv: 'test', logLevel: 'silent', webOrigin: 'http://localhost:0',
  embeddingsEnabled: false, repoIntelEnabled: false, promptLogVerbose: false, promptLogVerboseIgnored: false,
  promptLogEnabled: false,
} as AppConfig;

const pull = { id: 'pr-1', workspaceId: 'ws-1', repoId: 'repo-1', number: 42, title: 'T', author: 'a', headSha: 'x' } as PullRow;
const repoRow = { id: 'repo-1', owner: 'acme', name: 'w' } as typeof schema.repos.$inferSelect;
const agent = (n: number) => ({ id: `agent-${n}`, name: `A${n}`, provider: 'openai', model: 'm', version: 1 }) as AgentRow;
const diff = (files: number): UnifiedDiff => ({ raw: 'x', files: Array.from({ length: files }, (_, i) => ({ path: `f${i}`, additions: 1, deletions: 0 })) }) as unknown as UnifiedDiff;

function build() {
  const repo = new ReviewRepository(UNUSED_DB);
  const completed: { runId: string; status: string; error?: string | null }[] = [];
  repo.completeAgentRun = async (runId, v) => void completed.push({ runId, status: v.status, error: v.error });
  repo.saveRunTrace = async () => undefined;
  const executor = new ReviewRunExecutor(new Container(config, UNUSED_DB, {}), repo, new AgentsRepository(UNUSED_DB));
  const runOne = vi.fn();
  (executor as unknown as { runOneAgent: unknown }).runOneAgent = runOne;
  const jobs = [1, 2, 3].map((n) => ({ agent: agent(n), runId: `run-${n}` }));
  return { executor, runOne, completed, jobs };
}
const outcome = { findings: [], grounding: '0/0 passed' };

describe('ReviewRunExecutor fan-out', () => {
  beforeEach(() => {
    loadDiffMock.mockReset().mockResolvedValue(diff(2));
    deriveIntentMock.mockReset().mockResolvedValue(undefined);
  });

  it('loads the diff and intent once and runs every agent once', async () => {
    const { executor, runOne, jobs } = build();
    runOne.mockResolvedValue(outcome);
    await executor.executeRuns('ws-1', pull, repoRow, jobs);
    expect(loadDiffMock).toHaveBeenCalledTimes(1);
    expect(deriveIntentMock).toHaveBeenCalledTimes(1);
    expect(runOne).toHaveBeenCalledTimes(3);
  });

  it('starts all 3 agents before any of them resolves', async () => {
    const { executor, runOne, jobs } = build();
    const release: (() => void)[] = [];
    runOne.mockImplementation(() => new Promise((res) => release.push(() => res(outcome))));
    const done = executor.executeRuns('ws-1', pull, repoRow, jobs);
    await vi.waitFor(() => expect(runOne).toHaveBeenCalledTimes(3));
    expect(release).toHaveLength(3);
    release.forEach((r) => r());
    await done;
  });

  it('one throw and one cancellation do not stop the third', async () => {
    const { executor, runOne, jobs } = build();
    let third = false;
    runOne
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new RunCancelledError())
      .mockImplementationOnce(async () => { third = true; return outcome; });
    await expect(executor.executeRuns('ws-1', pull, repoRow, jobs)).resolves.toBeUndefined();
    expect(third).toBe(true);
  });

  it('a diff-load failure fails every run with its message and starts no agent', async () => {
    loadDiffMock.mockRejectedValue(new Error('clone failed'));
    const { executor, runOne, completed, jobs } = build();
    await executor.executeRuns('ws-1', pull, repoRow, jobs);
    expect(runOne).not.toHaveBeenCalled();
    expect(completed.map((c) => c.status)).toEqual(['failed', 'failed', 'failed']);
    for (const c of completed) expect(c.error).toMatch(/Failed to load PR diff/);
  });

  it('a zero-file diff still runs every agent and never takes the failAll path', async () => {
    loadDiffMock.mockResolvedValue(diff(0));
    const { executor, runOne, completed, jobs } = build();
    runOne.mockResolvedValue(outcome);
    await executor.executeRuns('ws-1', pull, repoRow, jobs);
    expect(runOne).toHaveBeenCalledTimes(3);
    expect(completed).toHaveLength(0);
  });
});
