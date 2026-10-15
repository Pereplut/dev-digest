/** groupFindings (spec 0021, AC-16..AC-22). Pure. */
import { describe, it, expect } from 'vitest';
import type { Severity } from '@devdigest/shared';
import { groupFindings, type GroupingColumn, type GroupingFinding } from '../src/modules/reviews/multi-agent-grouping.js';

let seq = 0;
const f = (file: string, start: number, end: number | null, severity: Severity = 'WARNING', title = `t${seq}`): GroupingFinding => ({
  id: `f${String(++seq).padStart(5, '0')}`, file, start_line: start, end_line: end, severity, title,
});
const col = (n: number, findings: GroupingFinding[], status = 'done'): GroupingColumn => ({
  run_id: `r${n}`, agent_id: `a${n}`, agent_name: `Agent ${n}`, status, findings,
});

describe('groupFindings', () => {
  it('lines 10 and 12 group; 10 and 14 group by tolerance; 10 and 20 do not', () => {
    expect(groupFindings([col(1, [f('a.ts', 10, 10)]), col(2, [f('a.ts', 12, 12)])])).toHaveLength(1);
    expect(groupFindings([col(1, [f('a.ts', 10, 10)]), col(2, [f('a.ts', 14, 14)])])).toHaveLength(1);
    expect(groupFindings([col(1, [f('a.ts', 10, 10)]), col(2, [f('a.ts', 15, 15)])])).toHaveLength(2);
    expect(groupFindings([col(1, [f('a.ts', 10, 10)]), col(2, [f('a.ts', 20, 20)])])).toHaveLength(2);
  });

  it('a chain A-B-C is one group even when A and C do not overlap', () => {
    const g = groupFindings([col(1, [f('a.ts', 10, 12)]), col(2, [f('a.ts', 15, 18)]), col(3, [f('a.ts', 21, 22)])]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ start_line: 10, end_line: 22 });
  });

  it('same lines in two files are two groups, ordered by file', () => {
    const g = groupFindings([col(1, [f('b.ts', 5, 5), f('a.ts', 5, 5)])]);
    expect(g.map((x) => x.file)).toEqual(['a.ts', 'b.ts']);
  });

  it('identical titles with disjoint ranges are two groups', () => {
    expect(groupFindings([col(1, [f('a.ts', 1, 1, 'WARNING', 'same'), f('a.ts', 100, 100, 'WARNING', 'same')])])).toHaveLength(2);
  });

  it('every finding id appears exactly once, under its own run', () => {
    const c1 = [f('a.ts', 1, 3), f('a.ts', 50, 51)];
    const c2 = [f('a.ts', 2, 2)];
    const g = groupFindings([col(1, c1), col(2, c2)]);
    const seen = g.flatMap((x) => x.takes.flatMap((t) => t.finding_ids.map((i) => `${t.run_id}:${i}`)));
    expect(seen.sort()).toEqual([...c1.map((x) => `r1:${x.id}`), ...c2.map((x) => `r2:${x.id}`)].sort());
  });

  it('one take per done column (ignored + [] when silent); none for failed/cancelled', () => {
    const g = groupFindings([
      col(1, [f('a.ts', 1, 1)]), col(2, []), col(3, []), col(4, [], 'failed'), col(5, [], 'cancelled'),
    ]);
    expect(g[0]!.takes).toHaveLength(3);
    const silent = g[0]!.takes.find((t) => t.run_id === 'r2')!;
    expect(silent).toMatchObject({ verdict: 'ignored', note: '', finding_ids: [] });
  });

  it('verdict is the highest severity with that finding\'s title; group title from the top; tie on start_line', () => {
    const w = f('a.ts', 5, 5, 'WARNING', 'warn');
    const s = f('a.ts', 4, 4, 'SUGGESTION', 'sugg');
    const w2 = f('a.ts', 3, 3, 'WARNING', 'earlier warn');
    const g = groupFindings([col(1, [w, s]), col(2, [w2])]);
    expect(g[0]!.takes.find((t) => t.run_id === 'r1')).toMatchObject({ verdict: 'WARNING', note: 'warn' });
    expect(g[0]!.title).toBe('earlier warn');
  });

  it('divergent: flagging agents disagree on severity; "did not flag" alone is not a conflict', () => {
    expect(groupFindings([col(1, [f('a.ts', 1, 1)]), col(2, [f('a.ts', 1, 1)])])[0]!.divergent).toBe(false);
    expect(groupFindings([col(1, [f('a.ts', 1, 1)]), col(2, [f('a.ts', 1, 1, 'CRITICAL')])])[0]!.divergent).toBe(true);
    expect(groupFindings([col(1, [f('a.ts', 1, 1)]), col(2, [])])[0]!.divergent).toBe(false);
    expect(groupFindings([col(1, [f('a.ts', 1, 1)]), col(2, [f('a.ts', 1, 1, 'CRITICAL')]), col(3, [])])[0]!.divergent).toBe(true);
  });

  it('a range more than 3x longer does not absorb the narrow findings inside it', () => {
    // PR #6, routes.ts: "all routes lack auth" 9-64 vs SSRF 59-63 / 61-63.
    const g = groupFindings([
      col(1, [f('r.ts', 9, 64), f('r.ts', 59, 63)]),
      col(2, [f('r.ts', 18, 49), f('r.ts', 34, 37)]),
      col(3, [f('r.ts', 61, 63)]),
    ]);
    expect(g.map((x) => [x.start_line, x.end_line])).toEqual([[9, 64], [34, 37], [59, 63]]);
  });

  it('lengths exactly 3x apart still group; just over 3x do not', () => {
    expect(groupFindings([col(1, [f('a.ts', 10, 12)]), col(2, [f('a.ts', 10, 10)])])).toHaveLength(1);
    expect(groupFindings([col(1, [f('a.ts', 10, 13)]), col(2, [f('a.ts', 10, 10)])])).toHaveLength(2);
  });

  it('output is identical for any permutation of columns and findings', () => {
    const cols = [
      col(1, [f('a.ts', 1, 2), f('b.ts', 9, 9, 'CRITICAL')]),
      col(2, [f('a.ts', 3, 3, 'SUGGESTION'), f('a.ts', 40, 41)]),
      col(3, [f('b.ts', 10, 12)]),
    ];
    const base = groupFindings(cols);
    const shuffled = [cols[2]!, { ...cols[0]!, findings: [...cols[0]!.findings].reverse() }, { ...cols[1]!, findings: [...cols[1]!.findings].reverse() }];
    expect(groupFindings(shuffled)).toEqual(base);
  });

  it('a null or inverted end_line clamps to the start line', () => {
    const g1 = groupFindings([col(1, [f('a.ts', 10, null)])]);
    const g2 = groupFindings([col(1, [f('a.ts', 10, 3)])]);
    expect(g1[0]).toMatchObject({ start_line: 10, end_line: 10 });
    expect(g2[0]).toMatchObject({ start_line: 10, end_line: 10 });
  });

  it('500 findings including 2147483647 group in under 100 ms', () => {
    const findings: GroupingFinding[] = [];
    for (let i = 0; i < 498; i++) findings.push(f(`file${i % 7}.ts`, (i * 37) % 4000, null));
    findings.push(f('big.ts', 2147483647, 2147483647), f('big.ts', 1, 2147483647));
    const cols = [col(1, findings.slice(0, 250)), col(2, findings.slice(250))];
    const t0 = performance.now();
    const g = groupFindings(cols);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(g.length).toBeGreaterThan(0);
  });
});
