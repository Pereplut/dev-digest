/**
 * adapters/mocks.ts — ring 4 (infra). Deterministic, in-memory
 * `DevDigestApi` — no network, no MCP SDK. This is what lets every tool be
 * exercised end to end without Docker or a running API (spec 0011 acceptance
 * criterion 9).
 */
import type {
  AgentSummary,
  BlastRadiusResult,
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

/** Uuid-shaped so the mock is usable through tools that validate ids. */
export const MOCK_RUN_ID = '11111111-1111-4111-8111-111111111111';

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

  pulls: PullDetail[] = [
    { id: 'pull-1', repoId: 'repo-1', number: 42, title: 'Add smart diff grouping' },
    { id: 'pull-2', repoId: 'repo-1', number: 99, title: 'Rename a helper with no downstream index' },
  ];

  runs = new Map<string, MockRun>([
    [
      MOCK_RUN_ID,
      {
        runId: MOCK_RUN_ID,
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

  /** Keyed by pull id. `pull-1` is the populated map, `pull-2` the degraded
   *  one — the two shapes `get_blast_radius` must handle identically to the
   *  page it backs. */
  blastRadii = new Map<string, BlastRadiusResult>([
    [
      'pull-1',
      {
        changedSymbols: [{ name: 'getContext', file: 'src/modules/_shared/context.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'getContext',
            callers: [
              { name: 'listPulls', file: 'src/modules/pulls/routes.ts', line: 12 },
              { name: 'getFindings', file: 'src/modules/findings/routes.ts', line: 30 },
            ],
            endpointsAffected: ['GET /pulls', 'GET /runs/:id/findings'],
            cronsAffected: [],
          },
        ],
        summary: '1 changed symbol · 2 callers · 2 endpoints · 0 cron jobs',
      },
    ],
    [
      'pull-2',
      {
        changedSymbols: [{ name: 'renameHelper', file: 'src/lib/helper.ts', kind: 'function' }],
        downstream: [],
        summary: '1 changed symbol · 0 callers · 0 endpoints · 0 cron jobs',
        degraded: true,
        reason: 'no_data',
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
      // Uuid-shaped, like the real API's ids: `get_findings` constrains `run_id`
      // to `z.string().uuid()` to match the wrapped route, so a mock that
      // minted `run-2` would be unusable through the tool surface — and that
      // unfaithfulness is what hid an unencoded-path-segment defect.
      const runId = `22222222-2222-4222-8222-${String(this.nextRunId++).padStart(12, '0')}`;
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

  async getBlastRadius(prId: string): Promise<BlastRadiusResult> {
    const result = this.blastRadii.get(prId);
    if (!result) throw new Error(`mock: no blast radius for pull ${prId}`);
    return result;
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
