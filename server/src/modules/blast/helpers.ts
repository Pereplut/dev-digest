import type {
  BlastCaller,
  BlastRadius,
  ChangedSymbol,
  DownstreamImpact,
} from '@devdigest/shared';
import type { BlastCallerRow, BlastResult } from '../repo-intel/types.js';
import { MAX_CALLERS_PER_SYMBOL } from './constants.js';

/**
 * Blast radius mapping (pure — no DB, no `this`, no I/O).
 *
 * `BlastResult` (repo-intel/types.ts) is a FLAT `callers[]`, each row tagged
 * with the `viaSymbol` it reaches. `BlastRadius` (the contract) wants
 * `downstream[]` GROUPED by changed symbol, with endpoints/crons attributed
 * per group. This is the whole of that mapping.
 *
 * No model call anywhere in this file — `summary` is composed from counts.
 */

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** House style: dot-separated counts, e.g. "2 symbols · 14 callers · 3 endpoints · 1 cron". */
function buildSummary(symbols: number, callers: number, endpoints: number, crons: number): string {
  return [
    plural(symbols, 'symbol'),
    plural(callers, 'caller'),
    plural(endpoints, 'endpoint'),
    plural(crons, 'cron'),
  ].join(' · ');
}

/** Group callers by the changed symbol they reach, preserving `result.callers` order. */
function groupByViaSymbol(callers: BlastCallerRow[]): Map<string, BlastCallerRow[]> {
  const byViaSymbol = new Map<string, BlastCallerRow[]>();
  for (const row of callers) {
    const group = byViaSymbol.get(row.viaSymbol);
    if (group) group.push(row);
    else byViaSymbol.set(row.viaSymbol, [row]);
  }
  return byViaSymbol;
}

export function buildBlastRadius(result: BlastResult): BlastRadius {
  const byViaSymbol = groupByViaSymbol(result.callers);

  const changedSymbols: ChangedSymbol[] = result.changedSymbols.map((s) => ({
    name: s.name,
    file: s.file,
    kind: s.kind,
  }));

  const downstream: DownstreamImpact[] = [];
  for (const sym of result.changedSymbols) {
    const rows = byViaSymbol.get(sym.name);
    if (!rows || rows.length === 0) continue;

    // Rank descending, then cap at MAX_CALLERS_PER_SYMBOL — re-applied here so
    // this helper is correct standalone, independent of the facade's own cap.
    // `wasCapped` records whether this pass actually dropped a row: only the
    // server (which saw the pre-cap count) can say that truthfully — a group
    // with exactly MAX_CALLERS_PER_SYMBOL real callers and nothing dropped
    // must not be told it was truncated.
    const wasCapped = rows.length > MAX_CALLERS_PER_SYMBOL;
    const capped = [...rows].sort((a, b) => b.rank - a.rank).slice(0, MAX_CALLERS_PER_SYMBOL);
    const callers: BlastCaller[] = capped.map((r) => ({
      name: r.symbol,
      file: r.file,
      line: r.line,
    }));

    // Endpoints/crons: the union of factsByFile over the files of THIS
    // group's surviving callers only. factsByFile is absent on the degraded
    // path — then both arrays are []. Never throws, never indexes blindly.
    const endpoints = new Set<string>();
    const crons = new Set<string>();
    const callerFiles = new Set(capped.map((r) => r.file));
    for (const file of callerFiles) {
      const facts = result.factsByFile?.[file];
      if (!facts) continue;
      for (const e of facts.endpoints) endpoints.add(e);
      for (const c of facts.crons) crons.add(c);
    }

    const impact: DownstreamImpact = {
      symbol: sym.name,
      callers,
      endpoints_affected: [...endpoints].sort(),
      crons_affected: [...crons].sort(),
    };
    // Omitted when false, matching the `degraded`/`reason` minimal-payload
    // convention below.
    if (wasCapped) impact.capped = true;
    downstream.push(impact);
  }

  const totalCallers = downstream.reduce((n, d) => n + d.callers.length, 0);
  const totalEndpoints = new Set(downstream.flatMap((d) => d.endpoints_affected)).size;
  const totalCrons = new Set(downstream.flatMap((d) => d.crons_affected)).size;

  const radius: BlastRadius = {
    changed_symbols: changedSymbols,
    downstream,
    summary: buildSummary(changedSymbols.length, totalCallers, totalEndpoints, totalCrons),
  };
  // Pass through unchanged when present; omitted otherwise so the payload
  // stays minimal on the happy path.
  if (result.degraded !== undefined) radius.degraded = result.degraded;
  if (result.reason !== undefined) radius.reason = result.reason;
  return radius;
}
