/**
 * core/project.ts — ring 1 (core). Pure free functions only: no MCP SDK, no
 * Zod, no `fetch`. Everything a tool handler needs to turn `DevDigestApi`
 * data into the shape that goes on the wire — concise/detailed projection,
 * severity/category filtering, truncation, agent rollup, conventions
 * rendering, slug resolution — lives here so it is unit-testable with no
 * network and no SDK (spec 0011 "The token budget is ring 1").
 */
import type {
  AgentSummary,
  ConventionItem,
  ConventionsPage,
  FindingCategory,
  FindingItem,
  RepoSummary,
  RunListItem,
  Severity,
} from '../ports.js';

export type ResponseFormat = 'concise' | 'detailed';

// ---- Repo slug resolution ---------------------------------------------------

export type RepoResolution =
  | { ok: true; repo: RepoSummary }
  | { ok: false; closest: string | null };

/** `owner/name`, case-insensitive exact match against `RepoSummary.fullName`. */
export function resolveRepoSlug(repos: RepoSummary[], slug: string): RepoResolution {
  const normalized = slug.trim().toLowerCase();
  const match = repos.find((r) => r.fullName.toLowerCase() === normalized);
  if (match) return { ok: true, repo: match };
  return { ok: false, closest: closestSlug(repos, normalized) };
}

/** Nearest `full_name` by edit distance — the "Did you mean" suggestion. Null
 * when the workspace has no repos to suggest at all. */
export function closestSlug(repos: RepoSummary[], slug: string): string | null {
  if (repos.length === 0) return null;
  let best = repos[0]!.fullName;
  let bestDistance = levenshtein(slug, best.toLowerCase());
  for (const repo of repos.slice(1)) {
    const d = levenshtein(slug, repo.fullName.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = repo.fullName;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) dist[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i]![j] = Math.min(
        dist[i - 1]![j]! + 1,
        dist[i]![j - 1]! + 1,
        dist[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dist[rows - 1]![cols - 1]!;
}

// ---- Agents -----------------------------------------------------------------

export interface AgentConcise {
  id: string;
  name: string;
  model: string;
  enabled: boolean;
}

export interface AgentDetailed extends AgentConcise {
  description: string;
  strategy: string;
  ci_fail_on: string;
  skill_count: number | null;
}

export function projectAgent(agent: AgentSummary, format: ResponseFormat): AgentConcise | AgentDetailed {
  const concise: AgentConcise = {
    id: agent.id,
    name: agent.name,
    model: agent.model,
    enabled: agent.enabled,
  };
  if (format === 'concise') return concise;
  return {
    ...concise,
    description: agent.description,
    strategy: agent.strategy,
    ci_fail_on: agent.ciFailOn,
    skill_count: agent.skillCount,
  };
}

export function projectAgents(
  agents: AgentSummary[],
  format: ResponseFormat,
): (AgentConcise | AgentDetailed)[] {
  return agents.map((a) => projectAgent(a, format));
}

/** The enabled-agent name list for the "Agent disabled" error text. */
export function enabledAgentNames(agents: AgentSummary[]): string[] {
  return agents.filter((a) => a.enabled).map((a) => a.name);
}

// ---- Findings -----------------------------------------------------------------

/** Rationale/suggestion are markdown and can be long; cap them so `detailed`
 * cannot blow the token budget on a single finding. */
export const MAX_FINDING_TEXT_CHARS = 2000;

export function truncateText(text: string, maxChars = MAX_FINDING_TEXT_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}… [truncated, ${text.length} chars total]`;
}

export interface FindingConcise {
  file: string;
  line: number;
  severity: Severity;
  title: string;
}

export interface FindingDetailed extends FindingConcise {
  rationale: string;
  suggestion: string | null;
}

export function projectFinding(finding: FindingItem, format: ResponseFormat): FindingConcise | FindingDetailed {
  const concise: FindingConcise = {
    file: finding.file,
    line: finding.startLine,
    severity: finding.severity,
    title: finding.title,
  };
  if (format === 'concise') return concise;
  return {
    ...concise,
    rationale: truncateText(finding.rationale),
    suggestion: finding.suggestion ? truncateText(finding.suggestion) : null,
  };
}

export function projectFindings(
  findings: FindingItem[],
  format: ResponseFormat,
): (FindingConcise | FindingDetailed)[] {
  return findings.map((f) => projectFinding(f, format));
}

/** Severity/category filtering, done in-memory over an already-fetched page —
 * used for the repo+pull_number path, which reads whole reviews (the SQL
 * route filters server-side instead; see tools/findings.ts). */
export function filterFindings(
  findings: FindingItem[],
  filter: { severity?: Severity[]; category?: FindingCategory[] },
): FindingItem[] {
  return findings.filter((f) => {
    if (filter.severity && filter.severity.length > 0 && !filter.severity.includes(f.severity)) {
      return false;
    }
    if (filter.category && filter.category.length > 0 && !filter.category.includes(f.category)) {
      return false;
    }
    return true;
  });
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Opaque offset cursor (base64 of a JSON `{offset}`) for the paths that
 * paginate in memory rather than in SQL. Mirrors the "opaque to the caller"
 * cursor convention `server/src/modules/_shared/schemas.ts` `PageQuery` uses. */
export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

/**
 * A cursor either decodes or it does not. Collapsing failure to offset 0 makes
 * a bad cursor indistinguishable from no cursor, so the caller is handed page
 * one *as if it were the next page* — silently, forever. The route this tool
 * wraps takes the opposite position for the same input (`AppError
 * 'invalid_cursor'`, 400, with its own regression test), and the two halves
 * should not disagree.
 *
 * The realistic trigger is not a corrupted string: the `run_id` path's cursor
 * is the server's base64 `"<rank>|<uuid>"`, this path's is a base64 `{offset}`.
 * They are different formats, so passing one to the other is an ordinary
 * mistake that must produce an error rather than a repeat of page one.
 */
export type CursorDecode = { ok: true; offset: number } | { ok: false };

export function decodeCursor(cursor: string | undefined): CursorDecode {
  if (!cursor) return { ok: true, offset: 0 };
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: unknown };
    const { offset } = parsed;
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) return { ok: false };
    return { ok: true, offset };
  } catch {
    return { ok: false };
  }
}

export type Paginated<T> = { ok: true; page: Page<T> } | { ok: false };

export function paginate<T>(items: T[], opts: { limit: number; cursor?: string }): Paginated<T> {
  const decoded = decodeCursor(opts.cursor);
  if (!decoded.ok) return { ok: false };

  const { offset } = decoded;
  const slice = items.slice(offset, offset + opts.limit);
  const nextOffset = offset + slice.length;
  return {
    ok: true,
    page: {
      items: slice,
      nextCursor: nextOffset < items.length ? encodeCursor(nextOffset) : null,
    },
  };
}

// ---- Conventions --------------------------------------------------------------

export interface ConventionConcise {
  category: string;
  rule: string;
  evidence_path: string;
}

export interface ConventionDetailed extends ConventionConcise {
  evidence_snippet: string;
}

export function projectConvention(
  item: ConventionItem,
  format: ResponseFormat,
): ConventionConcise | ConventionDetailed {
  const concise: ConventionConcise = {
    category: item.category,
    rule: item.rule,
    evidence_path: item.evidencePath,
  };
  if (format === 'concise') return concise;
  return { ...concise, evidence_snippet: truncateText(item.evidenceSnippet) };
}

export interface ConventionsProjection {
  conventions: (ConventionConcise | ConventionDetailed)[];
  scan_status: 'idle' | 'running' | 'done' | 'failed' | null;
}

export function projectConventions(page: ConventionsPage, format: ResponseFormat): ConventionsProjection {
  return {
    conventions: page.candidates.map((c) => projectConvention(c, format)),
    scan_status: page.scanStatus,
  };
}

/**
 * The runs belonging to the CURRENT review wave, newest-first input assumed.
 *
 * `listRunsForPull` returns every run a pull request has ever had. Taking the
 * latest run per agent is not enough: a run whose agent has since been deleted
 * keys on nothing (`agentId: null`) and survives forever as its own pseudo-agent,
 * so the denominator of "N of M agents done" counts history. Observed on
 * Pereplut/dev-digest#6 — four runs started, but a `failed` run from a deleted
 * agent nine days earlier made it "0 of 5 agents done", a total that could never
 * be reached and would read as permanently stuck.
 *
 * The wave is every run started at or after the OLDEST still-running run.
 * Anything earlier is finished history, whatever its status. With no run in
 * flight there is no wave and the caller reads results instead.
 */
/**
 * Largest gap between two runs of the same wave. `review_pull_request` creates
 * every `agent_runs` row for a review in one loop, so a wave's timestamps sit
 * milliseconds apart (observed: 723, 727, 730, 732 ms); separate reviews are
 * minutes or days apart. 60s is far above the one and far below the other.
 */
const WAVE_GAP_MS = 60_000;

export function currentWave(runs: RunListItem[]): RunListItem[] {
  const inFlight = runs.filter((r) => r.status === 'running');
  if (inFlight.length === 0) return [];

  // A run in flight with no timestamp cannot be placed in a cluster, but it also
  // cannot be history — history has finished. Keep it, and note that emptiness
  // is decided by "is anything running", never by missing timestamps: the other
  // way round serves results mid-review.
  const stamped = runs.filter(
    (r): r is RunListItem & { ranAt: string } => r.ranAt !== null && !Number.isNaN(Date.parse(r.ranAt)),
  );
  const unstampedInFlight = inFlight.filter((r) => r.ranAt === null || Number.isNaN(Date.parse(r.ranAt)));
  if (stamped.length === 0) return inFlight;

  // Walk newest-first and stop at the first gap bigger than a wave: that is the
  // boundary between this review and the previous one. Anchoring on the oldest
  // RUNNING run instead would drop the wave's earliest agent the moment it
  // finished — the denominator would shrink as runs completed and `done` would
  // read 0 while results were already in.
  const sorted = [...stamped].sort((a, b) => Date.parse(b.ranAt) - Date.parse(a.ranAt));
  const cluster: RunListItem[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = Date.parse(sorted[i - 1]!.ranAt) - Date.parse(sorted[i]!.ranAt);
    if (gap > WAVE_GAP_MS) break;
    cluster.push(sorted[i]!);
  }

  // Only a cluster that still has a run going is the *current* wave.
  if (!cluster.some((r) => r.status === 'running')) return unstampedInFlight;
  return [...cluster, ...unstampedInFlight];
}
