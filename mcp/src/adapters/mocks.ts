/**
 * adapters/mocks.ts — ring 4 (infra). Deterministic, in-memory
 * `DevDigestApi` — no network, no MCP SDK. This is what lets every tool be
 * exercised end to end without Docker or a running API (spec 0011 acceptance
 * criterion 9).
 */
import type {
  AgentSummary,
  ConventionQuery,
  ConventionsPage,
  DevDigestApi,
  FindingItem,
  FindingQuery,
  PullDetail,
  RepoSummary,
  ReviewWithFindings,
  RunFindingsPage,
  RunListItem,
  RunStatusValue,
  RunTarget,
  StartedRun,
} from '../ports.js';

export interface MockRun {
  runId: string;
  agentId: string;
  agentName: string;
  pullId: string;
  status: RunStatusValue;
  /** When the run started, ISO-8601 — `currentWave` uses it to separate the
   *  current review wave from historical runs on the same pull. */
  ranAt: string | null;
  /** Citation-grounding tally, e.g. "2/2 passed". `null` while the run is
   *  still going; "0/0 passed" is the real API's value for a run handed an
   *  empty diff, which is why tools must be able to tell it apart from a
   *  genuinely clean review. */
  grounding: string | null;
  findings: FindingItem[];
}

/**
 * Seeded with one repo, three agents (one disabled), one pull request, and a
 * findings page — enough for every tool's happy path and its named error
 * texts. Mutate the exposed maps directly in a test to reshape a fixture
 * (e.g. `mock.runs.set(id, { ...run, status: 'done' })` to simulate a run
 * finishing between two polls).
 */
export class MockDevDigestApi implements DevDigestApi {
  repos: RepoSummary[] = [
    { id: 'repo-1', owner: 'acme', name: 'web', fullName: 'acme/web' },
  ];

  agents: AgentSummary[] = [
    {
      id: 'agent-1',
      name: 'Strict Reviewer',
      model: 'claude-sonnet-5',
      provider: 'anthropic',
      enabled: true,
      description: 'Blocks on any critical finding.',
      strategy: 'single-pass',
      ciFailOn: 'critical',
      skillCount: 2,
    },
    {
      id: 'agent-2',
      name: 'Style Nit',
      model: 'gpt-5',
      provider: 'openai',
      enabled: false,
      description: 'Style-only pass, disabled by default.',
      strategy: 'single-pass',
      ciFailOn: 'never',
      skillCount: 0,
    },
  ];

  pulls: PullDetail[] = [{ id: 'pull-1', repoId: 'repo-1', number: 42, title: 'Add smart diff grouping' }];

  runs = new Map<string, MockRun>([
    [
      'run-1',
      {
        runId: 'run-1',
        agentId: 'agent-1',
        agentName: 'Strict Reviewer',
        pullId: 'pull-1',
        status: 'done',
        ranAt: '2026-09-27T10:00:00.000Z',
        grounding: '2/2 passed',
        findings: [
          {
            id: 'finding-1',
            file: 'src/index.ts',
            startLine: 10,
            endLine: 12,
            severity: 'CRITICAL',
            category: 'security',
            title: 'Untrusted input reaches sql.raw',
            rationale: 'The repo id is interpolated into a raw SQL string with no parameterisation.',
            suggestion: 'Use a parameterised query instead of sql.raw string concatenation.',
          },
          {
            id: 'finding-2',
            file: 'src/index.ts',
            startLine: 40,
            endLine: 40,
            severity: 'SUGGESTION',
            category: 'style',
            title: 'Prefer const over let',
            rationale: 'The binding is never reassigned.',
            suggestion: null,
          },
        ],
      },
    ],
  ]);

  conventions: ConventionsPage = {
    candidates: [
      {
        category: 'naming',
        rule: 'Repository files are named `<entity>.repo.ts`.',
        evidencePath: 'server/src/modules/reviews/repository/review.repo.ts',
        evidenceStartLine: 1,
        evidenceEndLine: 1,
        evidenceSnippet: "export type ReviewRow = typeof t.reviews.$inferSelect;",
        status: 'accepted',
      },
    ],
    scanStatus: 'done',
  };

  private nextRunId = 2;

  async listRepos(): Promise<RepoSummary[]> {
    return this.repos;
  }

  async listAgents(): Promise<AgentSummary[]> {
    return this.agents;
  }

  async getPullByNumber(repoId: string, number: number): Promise<PullDetail | null> {
    return this.pulls.find((p) => p.repoId === repoId && p.number === number) ?? null;
  }

  async startReview(pullId: string, target: RunTarget): Promise<StartedRun[]> {
    const targets =
      'all' in target
        ? this.agents.filter((a) => a.enabled)
        : this.agents.filter((a) => a.id === target.agentId);
    const started: StartedRun[] = [];
    for (const agent of targets) {
      const runId = `run-${this.nextRunId++}`;
      this.runs.set(runId, {
        runId,
        agentId: agent.id,
        agentName: agent.name,
        pullId,
        status: 'running',
        ranAt: new Date().toISOString(),
        grounding: null,
        findings: [],
      });
      started.push({ runId, agentId: agent.id, agentName: agent.name });
    }
    return started;
  }

  async getRunFindings(runId: string, query: FindingQuery): Promise<RunFindingsPage> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`mock: no such run ${runId}`);
    if (run.status === 'running') {
      return { findings: [], status: 'running', grounding: null, nextCursor: null };
    }
    let findings = run.findings;
    if (query.severity && query.severity.length > 0) {
      findings = findings.filter((f) => query.severity!.includes(f.severity));
    }
    if (query.category && query.category.length > 0) {
      findings = findings.filter((f) => query.category!.includes(f.category));
    }
    const limit = query.limit ?? 20;
    const offset = query.cursor ? Number(query.cursor) || 0 : 0;
    const page = findings.slice(offset, offset + limit);
    const nextCursor = offset + page.length < findings.length ? String(offset + page.length) : null;
    return { findings: page, status: run.status, grounding: run.grounding, nextCursor };
  }

  async listReviews(pullId: string): Promise<ReviewWithFindings[]> {
    return [...this.runs.values()]
      .filter((r) => r.pullId === pullId && r.status === 'done')
      .map((r) => ({
        reviewId: `review-${r.runId}`,
        agentId: r.agentId,
        agentName: r.agentName,
        createdAt: new Date(0).toISOString(),
        findings: r.findings,
      }));
  }

  async listRunsForPull(pullId: string): Promise<RunListItem[]> {
    // Newest-first, matching the server route's contract — the mock's Map
    // insertion order already is newest-last, so reverse it.
    return [...this.runs.values()]
      .filter((r) => r.pullId === pullId)
      .reverse()
      .map((r) => ({ runId: r.runId, agentId: r.agentId, status: r.status, ranAt: r.ranAt }));
  }

  async getConventions(_repoId: string, query: ConventionQuery): Promise<ConventionsPage> {
    let candidates = this.conventions.candidates;
    if (query.status && query.status.length > 0) {
      candidates = candidates.filter((c) => query.status!.includes(c.status));
    }
    if (query.category) {
      candidates = candidates.filter((c) => c.category === query.category);
    }
    return { candidates, scanStatus: this.conventions.scanStatus };
  }
}
