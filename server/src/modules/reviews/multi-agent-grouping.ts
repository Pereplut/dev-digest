/**
 * Deterministic grouping of findings across the columns of a multi-agent run
 * (spec 0021, AC-16..AC-22). Pure: imports only `@devdigest/shared` types — no
 * DB, no `this`, no clock — so it unit-tests without Postgres.
 *
 * Two findings share a group exactly when they are on the same file and their
 * line ranges, each widened by TOLERANCE lines, overlap (transitively). That
 * relation is computed by sorting and sweeping — O(F log F) — rather than by
 * pairwise union-find (O(F²)), which would miss the 500-finding time bound.
 * The output depends only on the SET of inputs: every tie is broken down to
 * the finding id, and takes are ordered inside this function.
 */
import type { Conflict, ConflictTake, Severity } from '@devdigest/shared';

/** Each range is widened by this many lines on both sides before overlap is tested. */
const TOLERANCE = 2;

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

  const groups: Entry[][] = [];
  let current: Entry[] = [];
  let maxEnd = 0;
  for (const e of entries) {
    const last = current[0];
    // Widened ranges overlap iff e.start - T <= maxEnd + T (sorted by start).
    if (last && last.file === e.file && e.start - TOLERANCE <= maxEnd + TOLERANCE) {
      current.push(e);
      if (e.end > maxEnd) maxEnd = e.end;
    } else {
      if (current.length > 0) groups.push(current);
      current = [e];
      maxEnd = e.end;
    }
  }
  if (current.length > 0) groups.push(current);

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
      divergent: new Set(takes.map((t) => t.verdict)).size > 1,
      takes,
    };
  });
}
