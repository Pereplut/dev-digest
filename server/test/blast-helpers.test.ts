/**
 * `buildBlastRadius` is the flat→grouped mapping (spec 0012 §1) — the one
 * piece of real logic this feature adds. Tested without Postgres, without the
 * facade: `BlastResult` fixtures in, `BlastRadius` out.
 */
import { describe, it, expect } from 'vitest';
import { BlastRadius } from '@devdigest/shared';
import { buildBlastRadius } from '../src/modules/blast/helpers.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/blast/constants.js';
import type { BlastCallerRow, BlastResult } from '../src/modules/repo-intel/types.js';

function caller(over: Partial<BlastCallerRow> & { viaSymbol: string }): BlastCallerRow {
  return { file: 'b.ts', symbol: 'caller', line: 1, rank: 0, ...over };
}

describe('buildBlastRadius', () => {
  it('groups flat callers by viaSymbol into one DownstreamImpact each', () => {
    const result: BlastResult = {
      changedSymbols: [
        { file: 'a.ts', name: 'rateLimit', kind: 'function' },
        { file: 'a.ts', name: 'clamp', kind: 'function' },
      ],
      callers: [
        caller({ viaSymbol: 'rateLimit', file: 'router.ts', symbol: 'handler', line: 10, rank: 5 }),
        caller({ viaSymbol: 'clamp', file: 'util.ts', symbol: 'normalize', line: 3, rank: 2 }),
      ],
      impactedEndpoints: [],
    };
    const radius = buildBlastRadius(result);
    expect(radius.downstream).toHaveLength(2);
    expect(radius.downstream.map((d) => d.symbol).sort()).toEqual(['clamp', 'rateLimit']);
    const rl = radius.downstream.find((d) => d.symbol === 'rateLimit')!;
    expect(rl.callers).toEqual([{ name: 'handler', file: 'router.ts', line: 10 }]);
  });

  it('orders callers within a group by rank descending', () => {
    const result: BlastResult = {
      changedSymbols: [{ file: 'a.ts', name: 'rateLimit', kind: 'function' }],
      callers: [
        caller({ viaSymbol: 'rateLimit', file: 'low.ts', symbol: 'low', rank: 1 }),
        caller({ viaSymbol: 'rateLimit', file: 'high.ts', symbol: 'high', rank: 9 }),
        caller({ viaSymbol: 'rateLimit', file: 'mid.ts', symbol: 'mid', rank: 5 }),
      ],
      impactedEndpoints: [],
    };
    const radius = buildBlastRadius(result);
    const rl = radius.downstream[0]!;
    expect(rl.callers.map((c) => c.name)).toEqual(['high', 'mid', 'low']);
  });

  it('caps a group at MAX_CALLERS_PER_SYMBOL, keeping the highest-ranked, and reports capped: true', () => {
    const rows: BlastCallerRow[] = [];
    for (let i = 0; i < MAX_CALLERS_PER_SYMBOL + 5; i++) {
      rows.push(caller({ viaSymbol: 'rateLimit', file: `f${i}.ts`, symbol: `s${i}`, rank: i }));
    }
    const result: BlastResult = {
      changedSymbols: [{ file: 'a.ts', name: 'rateLimit', kind: 'function' }],
      callers: rows,
      impactedEndpoints: [],
    };
    const radius = buildBlastRadius(result);
    const rl = radius.downstream[0]!;
    expect(rl.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    // Highest ranks (24..5) survive — the lowest 5 (rank 0..4) are dropped.
    expect(rl.callers[0]!.name).toBe(`s${MAX_CALLERS_PER_SYMBOL + 4}`);
    expect(rl.callers.map((c) => c.name)).not.toContain('s0');
    // Only the server can know truncation happened — asserted here since it
    // saw the pre-cap row count (spec 0012, the "capped note" defect).
    expect(rl.capped).toBe(true);
  });

  it('does not report capped when a group has exactly MAX_CALLERS_PER_SYMBOL real callers and nothing was dropped', () => {
    const rows: BlastCallerRow[] = [];
    for (let i = 0; i < MAX_CALLERS_PER_SYMBOL; i++) {
      rows.push(caller({ viaSymbol: 'rateLimit', file: `f${i}.ts`, symbol: `s${i}`, rank: i }));
    }
    const result: BlastResult = {
      changedSymbols: [{ file: 'a.ts', name: 'rateLimit', kind: 'function' }],
      callers: rows,
      impactedEndpoints: [],
    };
    const radius = buildBlastRadius(result);
    const rl = radius.downstream[0]!;
    expect(rl.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(rl.capped).toBeUndefined();
    expect('capped' in rl).toBe(false);
  });

  it('attributes endpoints/crons from factsByFile over the group caller files only', () => {
    const result: BlastResult = {
      changedSymbols: [
        { file: 'a.ts', name: 'rateLimit', kind: 'function' },
        { file: 'a.ts', name: 'clamp', kind: 'function' },
      ],
      callers: [
        caller({ viaSymbol: 'rateLimit', file: 'router.ts', symbol: 'handler', rank: 1 }),
        caller({ viaSymbol: 'clamp', file: 'util.ts', symbol: 'normalize', rank: 1 }),
      ],
      impactedEndpoints: ['GET /x', 'POST /y'],
      factsByFile: {
        'router.ts': { endpoints: ['GET /x'], crons: [] },
        'util.ts': { endpoints: ['POST /y'], crons: ['nightly-sync'] },
      },
    };
    const radius = buildBlastRadius(result);
    const rl = radius.downstream.find((d) => d.symbol === 'rateLimit')!;
    const cl = radius.downstream.find((d) => d.symbol === 'clamp')!;
    expect(rl.endpoints_affected).toEqual(['GET /x']);
    expect(rl.crons_affected).toEqual([]);
    expect(cl.endpoints_affected).toEqual(['POST /y']);
    expect(cl.crons_affected).toEqual(['nightly-sync']);
  });

  it('factsByFile absent ⇒ empty endpoints/crons arrays, never throws', () => {
    const result: BlastResult = {
      changedSymbols: [{ file: 'a.ts', name: 'rateLimit', kind: 'function' }],
      callers: [caller({ viaSymbol: 'rateLimit', file: 'router.ts', rank: 1 })],
      impactedEndpoints: [],
      degraded: true,
      reason: 'no_data',
    };
    expect(() => buildBlastRadius(result)).not.toThrow();
    const radius = buildBlastRadius(result);
    expect(radius.downstream[0]!.endpoints_affected).toEqual([]);
    expect(radius.downstream[0]!.crons_affected).toEqual([]);
  });

  it('a zero-caller changed symbol appears in changed_symbols and gets no downstream entry', () => {
    const result: BlastResult = {
      changedSymbols: [
        { file: 'a.ts', name: 'rateLimit', kind: 'function' },
        { file: 'a.ts', name: 'unused', kind: 'function' },
      ],
      callers: [caller({ viaSymbol: 'rateLimit', file: 'router.ts', rank: 1 })],
      impactedEndpoints: [],
    };
    const radius = buildBlastRadius(result);
    expect(radius.changed_symbols.map((s) => s.name).sort()).toEqual(['rateLimit', 'unused']);
    expect(radius.downstream.map((d) => d.symbol)).toEqual(['rateLimit']);
  });

  /**
   * `buildBlastRadius` does not — and must not — re-implement the decl-file
   * exclusion. That invariant ("a changed symbol's declaring file never
   * appears among its own callers") is enforced upstream, in the facade's
   * best-effort path (`repo-intel/service.ts:277`,
   * `if (r.fromPath === sym.file) continue`), and is exercised end to end by
   * `server/test/repo-intel-blast-decl-exclusion.test.ts`.
   *
   * A version of this test that only ever fed `buildBlastRadius` an
   * other-file caller row passed under ANY implementation, including one that
   * reintroduced same-file callers upstream — the helper cannot invent rows
   * it wasn't given, so that assertion proved nothing about the exclusion.
   * What IS this helper's job: pass every row it is given straight through,
   * grouped by `viaSymbol` alone. It must NOT filter by matching a caller's
   * file against some OTHER changed symbol's decl file — grouping is by bare
   * symbol name, and a name can legitimately be declared in two different
   * files (e.g. `activeRunsForPull` is a `method` in
   * `server/src/modules/reviews/repository.ts:73` AND a `function` in
   * `reviews/repository/run.repo.ts:10`; the caller at `repository.ts:77`
   * legitimately reaches the free function). A name-based or file-based
   * filter here would silently delete a real caller like that one.
   */
  it('passes every caller row it is given straight through, even one whose file matches another changed symbol\'s decl file', () => {
    const result: BlastResult = {
      changedSymbols: [
        { file: 'a.ts', name: 'rateLimit', kind: 'function' },
        { file: 'b.ts', name: 'clamp', kind: 'function' },
      ],
      // `clamp`'s caller happens to live in `a.ts` — the decl file of the
      // UNRELATED symbol `rateLimit`. buildBlastRadius must not drop it: it
      // groups by viaSymbol name only, never by cross-checking filenames.
      callers: [caller({ viaSymbol: 'clamp', file: 'a.ts', symbol: 'weirdCaller', line: 5, rank: 1 })],
      impactedEndpoints: [],
    };
    const radius = buildBlastRadius(result);
    const cl = radius.downstream.find((d) => d.symbol === 'clamp')!;
    expect(cl.callers).toEqual([{ name: 'weirdCaller', file: 'a.ts', line: 5 }]);
  });

  it('summary: counts only, dot-separated, singular/plural handled, zero counts rendered', () => {
    const empty = buildBlastRadius({
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
    });
    expect(empty.summary).toBe('0 symbols · 0 callers · 0 endpoints · 0 crons');

    const singular = buildBlastRadius({
      changedSymbols: [{ file: 'a.ts', name: 'rateLimit', kind: 'function' }],
      callers: [caller({ viaSymbol: 'rateLimit', file: 'router.ts', rank: 1 })],
      impactedEndpoints: ['GET /x'],
      factsByFile: { 'router.ts': { endpoints: ['GET /x'], crons: ['nightly'] } },
    });
    expect(singular.summary).toBe(
      '1 symbol · 1 caller · 1 endpoint · 1 cron',
    );
  });

  it('degraded/reason pass through unchanged when present, omitted otherwise', () => {
    const degraded = buildBlastRadius({
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: true,
      reason: 'index_partial',
    });
    expect(degraded.degraded).toBe(true);
    expect(degraded.reason).toBe('index_partial');

    const happy = buildBlastRadius({ changedSymbols: [], callers: [], impactedEndpoints: [] });
    expect(happy.degraded).toBeUndefined();
    expect(happy.reason).toBeUndefined();
    expect('degraded' in happy).toBe(false);
  });

  it('produces a payload the contract accepts, with and without degraded fields', () => {
    const withFields = buildBlastRadius({
      changedSymbols: [{ file: 'a.ts', name: 'rateLimit', kind: 'function' }],
      callers: [caller({ viaSymbol: 'rateLimit', file: 'router.ts', rank: 1 })],
      impactedEndpoints: ['GET /x'],
      degraded: false,
    });
    expect(() => BlastRadius.parse(withFields)).not.toThrow();

    const withoutFields = buildBlastRadius({ changedSymbols: [], callers: [], impactedEndpoints: [] });
    expect(() => BlastRadius.parse(withoutFields)).not.toThrow();
  });
});
