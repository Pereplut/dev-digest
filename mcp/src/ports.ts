/**
 * ports.ts — ring 2 (port). Plain TypeScript. No Zod, no MCP SDK, no `fetch`,
 * and no import of any implementation (that would make this ring 2 file
 * depend on a ring 4 one, inverting the dependency rule the whole package is
 * built to demonstrate).
 *
 * `DevDigestApi` is the single seam between the tool surface (rings 3-4) and
 * the DevDigest REST API. `adapters/http/` implements it against `fetch`;
 * `adapters/mocks.ts` implements it in memory for tests. Every tool is
 * therefore unit-testable with no network — see AGENTS.md's ring table.
 *
 * `listRepos` exists because the API keys pull-request reads on the internal
 * repo UUID (`GET /repos/:id/pulls/:number`), while every MCP tool takes a
 * human `owner/name` slug (spec 0011 §"The port"). Resolving a slug to a repo
 * id is ring-3 (or, for the two tools with no real orchestration, done inline
 * in registry.ts against the ring-1 `resolveRepoSlug` projection) — never a
 * new server route.
 */

// ---- Repos ----------------------------------------------------------------

export interface RepoSummary {
  id: string;
  owner: string;
  name: string;
  fullName: string;
}

// ---- Agents -----------------------------------------------------------------

export interface AgentSummary {
  id: string;
  name: string;
  model: string;
  provider: string;
  enabled: boolean;
  description: string;
  strategy: string;
  ciFailOn: string;
  skillCount: number | null;
}

// ---- Pull requests ----------------------------------------------------------

export interface PullDetail {
  id: string;
  repoId: string;
  number: number;
  title: string;
}

// ---- Starting a review -------------------------------------------------------

/** Which agent(s) to run. Mirrors the server's `RunRequest` (agentId | all). */
export type RunTarget = { agentId: string } | { all: true };

export interface StartedRun {
  runId: string;
  agentId: string;
  agentName: string;
}

// ---- Findings -----------------------------------------------------------------

export type Severity = 'CRITICAL' | 'WARNING' | 'SUGGESTION';
export type FindingCategory = 'bug' | 'security' | 'perf' | 'style' | 'test';

export interface FindingItem {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  severity: Severity;
  category: FindingCategory;
  title: string;
  rationale: string;
  suggestion: string | null;
}

export interface FindingQuery {
  severity?: Severity[];
  category?: FindingCategory[];
  limit?: number;
  cursor?: string;
}

export type RunStatusValue = 'running' | 'done' | 'failed' | 'cancelled';

/**
 * `GET /runs/:id/findings` (confirmed shape, from the server agent building
 * the route): the run's own `status` only — NOT its sibling runs. A run id
 * alone does not carry its pull id, so "2 of 3 agents done" cannot be built
 * from this call; see `RunListItem`/`listRunsForPull` for the repo+pull_number
 * path, which legitimately knows the pull id.
 */
export interface RunFindingsPage {
  findings: FindingItem[];
  status: RunStatusValue | null;
  /** The run's citation-grounding tally, e.g. "3/4 passed"; "0/0 passed" when
   *  the agent had no diff to review. Disambiguates `findings: []` on a `done`
   *  run — a clean review and a review of nothing are otherwise identical. */
  grounding: string | null;
  nextCursor: string | null;
}

/** One agent's persisted review for a pull request, with its findings. */
export interface ReviewWithFindings {
  reviewId: string;
  agentId: string | null;
  agentName: string | null;
  createdAt: string;
  findings: FindingItem[];
}

/** One row of `GET /pulls/:id/runs` — enough to find the latest run per agent
 * and count how many of that batch are done, for the repo+pull_number
 * "still executing" progress message. */
export interface RunListItem {
  runId: string;
  agentId: string | null;
  status: RunStatusValue | null;
  /** When the run started, ISO-8601. Needed to tell the CURRENT review wave
   *  apart from historical runs on the same pull request — see
   *  `currentWave` in core/project.ts. */
  ranAt: string | null;
}

// ---- Blast radius -------------------------------------------------------------

export interface BlastChangedSymbol {
  name: string;
  file: string;
  kind: string;
}

export interface BlastCaller {
  name: string;
  file: string;
  line: number;
}

export interface BlastDownstreamImpact {
  symbol: string;
  /**
   * The file that declares `symbol` (spec 0012 fix). A bare name is not
   * unique — this codebase alone declares `renderWithIntl` in 8 files — so
   * an agent reading two same-named entries needs this to tell them apart.
   * Optional: absent on an older server response recorded before this field
   * existed.
   */
  file?: string;
  callers: BlastCaller[];
  endpointsAffected: string[];
  cronsAffected: string[];
}

/**
 * `GET /pulls/:id/blast` — a finished code-index read, no LLM call and no
 * clone parsing at request time. `degraded`/`reason` are present only when
 * the server reports the index behind this map is missing or partial, so the
 * happy path stays lean (mirrors `BlastRadius` in
 * `server/src/vendor/shared/contracts/brief.ts`).
 */
export interface BlastRadiusResult {
  changedSymbols: BlastChangedSymbol[];
  downstream: BlastDownstreamImpact[];
  summary: string;
  degraded?: boolean;
  reason?: string;
}

// ---- Conventions --------------------------------------------------------------

export type ConventionStatusValue = 'pending' | 'accepted' | 'rejected';

export interface ConventionItem {
  category: string;
  rule: string;
  evidencePath: string;
  evidenceStartLine: number | null;
  evidenceEndLine: number | null;
  evidenceSnippet: string;
  status: ConventionStatusValue;
}

export interface ConventionsPage {
  candidates: ConventionItem[];
  scanStatus: 'idle' | 'running' | 'done' | 'failed' | null;
}

export interface ConventionQuery {
  status?: ConventionStatusValue[];
  category?: string;
}

// ---- The port -----------------------------------------------------------------

export interface DevDigestApi {
  /** GET /repos — every repo in the workspace; slug ("owner/name") → id. */
  listRepos(): Promise<RepoSummary[]>;

  /** GET /agents */
  listAgents(): Promise<AgentSummary[]>;

  /** GET /repos/:id/pulls/:number — null when no such PR number exists. */
  getPullByNumber(repoId: string, number: number): Promise<PullDetail | null>;

  /** POST /pulls/:id/review */
  startReview(pullId: string, target: RunTarget): Promise<StartedRun[]>;

  /** GET /runs/:id/findings (new route) */
  getRunFindings(runId: string, query: FindingQuery): Promise<RunFindingsPage>;

  /** GET /pulls/:id/reviews — the latest persisted findings from every agent. */
  listReviews(pullId: string): Promise<ReviewWithFindings[]>;

  /** GET /pulls/:id/runs — every run (any status) for a pull, newest first.
   * Used only by the repo+pull_number path of `get_findings`, to detect a
   * run still in progress and count "N of M agents done". */
  listRunsForPull(pullId: string): Promise<RunListItem[]>;

  /** GET /repos/:id/conventions */
  getConventions(repoId: string, query: ConventionQuery): Promise<ConventionsPage>;

  /** GET /pulls/:id/blast — which symbols a pull request changes, which
   * callers reach them, and which endpoints/crons sit behind those callers. */
  getBlastRadius(prId: string): Promise<BlastRadiusResult>;
}
