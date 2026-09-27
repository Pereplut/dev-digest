/**
 * adapters/http/index.ts — ring 4 (infra). Implements `DevDigestApi` against
 * the DevDigest REST API. The response shapes below are hand-typed from
 * `server/src/vendor/shared/contracts/*` (never imported — rings 1-3 use
 * plain types, and the server is on Zod 3 while this package is on Zod 4).
 *
 * `GET /runs/:id/findings` (confirmed with the server agent building the
 * route, from `server/src/vendor/shared/contracts/findings.ts`): `severity`
 * and `category` are repeated query params (`?severity=CRITICAL&severity=…`,
 * a single value also accepted), `limit` defaults to 20 server-side too, and
 * the response is `{ findings, status, next_cursor }` — `status` is the
 * run's OWN status only, with no pull id and no sibling-run information (see
 * `ports.ts`'s `RunFindingsPage` and `core/errors.ts`'s `StillRunningInfo`
 * for why the "N of M agents done" clause needs `GET /pulls/:id/runs`
 * instead, via `listRunsForPull`).
 */
import type {
  AgentSummary,
  ConventionItem,
  ConventionQuery,
  ConventionsPage,
  DevDigestApi,
  FindingCategory,
  FindingItem,
  FindingQuery,
  PullDetail,
  RepoSummary,
  ReviewWithFindings,
  RunFindingsPage,
  RunListItem,
  RunStatusValue,
  RunTarget,
  Severity,
  StartedRun,
} from '../../ports.js';
import { HttpClient, type HttpClientOptions } from './client.js';

// ---- Wire shapes (snake_case, as the API returns them) ---------------------

interface RepoWire {
  id: string;
  owner: string;
  name: string;
  full_name: string;
}

interface AgentWire {
  id: string;
  name: string;
  model: string;
  provider: string;
  enabled: boolean;
  description: string;
  strategy: string;
  ci_fail_on: string;
  skill_count?: number | null;
}

interface PrDetailWire {
  id?: string | null;
  number: number;
  title: string;
}

interface ReviewRunResponseWire {
  pr_id: string;
  runs: { run_id: string; agent_id: string; agent_name: string }[];
}

interface FindingWire {
  id: string;
  file: string;
  start_line: number;
  end_line: number;
  severity: Severity;
  category: FindingCategory;
  title: string;
  rationale: string;
  suggestion?: string | null;
  // Present on the wire (review_id, accepted_at, dismissed_at) but not read —
  // neither port type needs finding-action state.
}

/** `GET /runs/:id/findings` response (`RunFindingsPage` in
 * `server/src/vendor/shared/contracts/findings.ts`). */
interface RunFindingsWire {
  findings: FindingWire[];
  status: RunStatusValue | null;
  grounding: string | null;
  next_cursor: string | null;
}

interface ReviewDtoWire {
  id: string;
  agent_id: string | null;
  agent_name?: string | null;
  created_at: string;
  findings: FindingWire[];
}

/** One row of `GET /pulls/:id/runs` (`RunSummary`) — only the three fields
 * `listRunsForPull` needs. */
interface RunSummaryWire {
  run_id: string;
  agent_id: string | null;
  status: RunStatusValue | null;
  ran_at: string | null;
}

interface ConventionCandidateWire {
  category: string;
  rule: string;
  evidence_path: string;
  evidence_start_line: number | null;
  evidence_end_line: number | null;
  evidence_snippet: string;
  status: 'pending' | 'accepted' | 'rejected';
}

interface ConventionsPageWire {
  candidates: ConventionCandidateWire[];
  scan: { status: 'running' | 'done' | 'failed' } | null;
}

// ---- Mapping -----------------------------------------------------------------

function mapFinding(w: FindingWire): FindingItem {
  return {
    id: w.id,
    file: w.file,
    startLine: w.start_line,
    endLine: w.end_line,
    severity: w.severity,
    category: w.category,
    title: w.title,
    rationale: w.rationale,
    suggestion: w.suggestion ?? null,
  };
}

function query(params: Record<string, string | number | string[] | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) usp.append(key, v);
    } else {
      usp.append(key, String(value));
    }
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

export class HttpDevDigestApi implements DevDigestApi {
  private readonly http: HttpClient;

  constructor(options: HttpClientOptions = {}) {
    this.http = new HttpClient(options);
  }

  async listRepos(): Promise<RepoSummary[]> {
    const repos = await this.http.get<RepoWire[]>('/repos');
    return repos.map((r) => ({ id: r.id, owner: r.owner, name: r.name, fullName: r.full_name }));
  }

  async listAgents(): Promise<AgentSummary[]> {
    const agents = await this.http.get<AgentWire[]>('/agents');
    return agents.map((a) => ({
      id: a.id,
      name: a.name,
      model: a.model,
      provider: a.provider,
      enabled: a.enabled,
      description: a.description,
      strategy: a.strategy,
      ciFailOn: a.ci_fail_on,
      skillCount: a.skill_count ?? null,
    }));
  }

  async getPullByNumber(repoId: string, number: number): Promise<PullDetail | null> {
    try {
      const pr = await this.http.get<PrDetailWire>(`/repos/${repoId}/pulls/${number}`);
      if (!pr.id) return null;
      return { id: pr.id, repoId, number: pr.number, title: pr.title };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async startReview(pullId: string, target: RunTarget): Promise<StartedRun[]> {
    const body = 'all' in target ? { all: true } : { agentId: target.agentId };
    const res = await this.http.post<ReviewRunResponseWire>(`/pulls/${pullId}/review`, body);
    return res.runs.map((r) => ({ runId: r.run_id, agentId: r.agent_id, agentName: r.agent_name }));
  }

  async getRunFindings(runId: string, q: FindingQuery): Promise<RunFindingsPage> {
    const qs = query({
      severity: q.severity,
      category: q.category,
      limit: q.limit,
      cursor: q.cursor,
    });
    const res = await this.http.get<RunFindingsWire>(`/runs/${runId}/findings${qs}`);
    return {
      findings: res.findings.map(mapFinding),
      status: res.status,
      grounding: res.grounding ?? null,
      nextCursor: res.next_cursor,
    };
  }

  async listReviews(pullId: string): Promise<ReviewWithFindings[]> {
    const reviews = await this.http.get<ReviewDtoWire[]>(`/pulls/${pullId}/reviews`);
    return reviews.map((r) => ({
      reviewId: r.id,
      agentId: r.agent_id,
      agentName: r.agent_name ?? null,
      createdAt: r.created_at,
      findings: r.findings.map(mapFinding),
    }));
  }

  async listRunsForPull(pullId: string): Promise<RunListItem[]> {
    const runs = await this.http.get<RunSummaryWire[]>(`/pulls/${pullId}/runs`);
    return runs.map((r) => ({
      runId: r.run_id,
      agentId: r.agent_id,
      status: r.status,
      ranAt: r.ran_at,
    }));
  }

  async getConventions(repoId: string, q: ConventionQuery): Promise<ConventionsPage> {
    const qs = query({ status: q.status, category: q.category });
    const res = await this.http.get<ConventionsPageWire>(`/repos/${repoId}/conventions${qs}`);
    const candidates: ConventionItem[] = res.candidates.map((c) => ({
      category: c.category,
      rule: c.rule,
      evidencePath: c.evidence_path,
      evidenceStartLine: c.evidence_start_line,
      evidenceEndLine: c.evidence_end_line,
      evidenceSnippet: c.evidence_snippet,
      status: c.status,
    }));
    return { candidates, scanStatus: res.scan?.status ?? null };
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && (err as { status: number }).status === 404;
}
