/**
 * Deterministic grouping of findings across the columns of a multi-agent run
 * (spec 0021, AC-16..AC-22). Pure: imports only `@devdigest/shared` types — no
 * DB, no `this`, no clock — so it unit-tests without Postgres.
 *
 * Two findings are linked when they are on the same file, their line ranges,
 * each widened by TOLERANCE lines, overlap, AND neither range is more than
 * MAX_LENGTH_RATIO times longer than the other. Groups are the connected
 * components of that relation. The ratio keeps a file-wide finding ("all routes
 * lack auth", lines 9-64) from swallowing every narrow finding inside it — on
 * PR #6 it had merged 9 unrelated findings into one group.
 * Linking is pairwise but pruned by start order (a finding is compared only with
 * those starting before its widened end), so 500 findings stay well under the
 * time bound. The output depends only on the SET of inputs: every tie is broken
 * down to the finding id, and takes are ordered inside this function.
 */
import type { Conflict, ConflictTake, Severity } from '@devdigest/shared';

/** Each range is widened by this many lines on both sides before overlap is tested. */
const TOLERANCE = 2;

/** Two linked ranges differ in length by at most this factor. */
const MAX_LENGTH_RATIO = 3;

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

export interface GroupingFinding {
  id: string;
  file: string;
  start_line: number;
  end_line: number | null;
  severity: Severity;
  title: string;
}

export interface GroupingColumn {
  run_id: string;
  agent_id: string | null;
  agent_name: string | null;
  status: string;
  findings: GroupingFinding[];
}

/** A finding with its clamped end and the run that produced it. */
interface Entry {
  id: string;
  runId: string;
  file: string;
  start: number;
  end: number;
  severity: Severity;
  title: string;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Order inside a group / take: by line, then id. */
function byStartThenId(a: Entry, b: Entry): number {
  return a.start - b.start || cmp(a.id, b.id);
}

/** The finding that speaks for a set: highest severity, then lowest start, then id. */
function topOf(entries: Entry[]): Entry {
  let best = entries[0]!;
  for (const e of entries) {
    const d = SEVERITY_RANK[e.severity] - SEVERITY_RANK[best.severity] || byStartThenId(e, best);
    if (d < 0) best = e;
  }
  return best;
}

export function groupFindings(columns: GroupingColumn[]): Conflict[] {
  // Takes exist only for `done` columns, ordered by (name, run id) so that
  // permuting the input cannot change the output.
  const done = columns
    .filter((c) => c.status === 'done')
    .sort((a, b) => cmp(a.agent_name ?? '', b.agent_name ?? '') || cmp(a.run_id, b.run_id));

  const entries: Entry[] = [];
  for (const col of done) {
    for (const f of col.findings) {
      // A null or inverted end clamps to the start line.
      const end = f.end_line == null || f.end_line < f.start_line ? f.start_line : f.end_line;
      entries.push({
        id: f.id,
        runId: col.run_id,
        file: f.file,
        start: f.start_line,
        end,
        severity: f.severity,
        title: f.title,
      });
    }
  }

  entries.sort((a, b) => cmp(a.file, b.file) || a.start - b.start || a.end - b.end || cmp(a.id, b.id));

  // Union-find over pairwise links; `parent` indexes into the sorted entries.
  const parent = entries.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  const length = (e: Entry) => e.end - e.start + 1;
  for (let i = 0; i < entries.length; i++) {
    const a = entries[i]!;
    for (let j = i + 1; j < entries.length; j++) {
      const b = entries[j]!;
      // Sorted by (file, start): once b starts past a's widened end, nothing later can link.
      if (b.file !== a.file || b.start - TOLERANCE > a.end + TOLERANCE) break;
      const [short, long] = length(a) <= length(b) ? [length(a), length(b)] : [length(b), length(a)];
      if (long <= MAX_LENGTH_RATIO * short) parent[find(j)] = find(i);
    }
  }

  // Components in order of their first (lowest-sorted) member.
  const byRoot = new Map<number, Entry[]>();
  entries.forEach((e, i) => {
    const root = find(i);
    const members = byRoot.get(root);
    if (members) members.push(e);
    else byRoot.set(root, [e]);
  });
  const groups = [...byRoot.values()];

  return groups.map((members) => {
    const top = topOf(members);
    const takes: ConflictTake[] = done.map((col) => {
      const mine = members.filter((m) => m.runId === col.run_id).sort(byStartThenId);
      if (mine.length === 0) {
        return {
          run_id: col.run_id,
          agent_id: col.agent_id,
          persona: col.agent_name,
          verdict: 'ignored',
          note: '',
          finding_ids: [],
        };
      }
      const spokesman = topOf(mine);
      return {
        run_id: col.run_id,
        agent_id: col.agent_id,
        persona: col.agent_name,
        verdict: spokesman.severity,
        note: spokesman.title,
        finding_ids: mine.map((m) => m.id),
      };
    });
    return {
      file: members[0]!.file,
      start_line: members[0]!.start,
      end_line: members.reduce((m, e) => (e.end > m ? e.end : m), members[0]!.end),
      title: top.title,
      // Agents that flagged the group disagree on severity. "Did not flag" is not a
      // conflict: with specialised agents nearly every group has a silent one.
      divergent: new Set(takes.filter((t) => t.verdict !== 'ignored').map((t) => t.verdict)).size > 1,
      takes,
    };
  });
}
