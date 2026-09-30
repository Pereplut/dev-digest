/* helpers.ts — pure mapping helpers for the Blast radius card (spec 0012).
   No I/O, no hooks: kept separate so BlastRadiusCard.tsx stays render logic. */
import type { DownstreamImpact } from "@/lib/types";

/**
 * Mirrored locally, not imported from `@devdigest/shared`: client code takes
 * only TYPES from the shared contracts barrel — a value import (even of a
 * plain union) typechecks and passes vitest but breaks `next build`, because
 * the vendored barrel re-exports with `.js` specifiers webpack cannot resolve
 * (client/INSIGHTS.md, 2026-09-19). These five values are
 * `DegradedReason` (`server/src/modules/repo-intel/types.ts:27-32`).
 */
export const BLAST_DEGRADED_REASONS = [
  "flag_off",
  "index_failed",
  "index_partial",
  "repo_too_large",
  "no_data",
] as const;
export type BlastDegradedReason = (typeof BLAST_DEGRADED_REASONS)[number];

/** An unknown/missing reason falls back to `no_data` rather than rendering a raw key. */
export function degradedReasonKey(reason: string | undefined): BlastDegradedReason {
  return (BLAST_DEGRADED_REASONS as readonly string[]).includes(reason ?? "")
    ? (reason as BlastDegradedReason)
    : "no_data";
}

/** Sum of callers across every downstream group. */
export function totalCallers(downstream: DownstreamImpact[]): number {
  return downstream.reduce((sum, group) => sum + group.callers.length, 0);
}

/** Deduped, sorted union of string arrays (endpoints/crons across all groups). */
export function uniqueSorted(values: string[][]): string[] {
  return Array.from(new Set(values.flat())).sort();
}

/**
 * The identity key for a changed symbol / downstream group: `(file, name)`,
 * never `name` alone — a bare symbol name is not unique (spec 0012 fix), so
 * two changed symbols can share a name while living in different files.
 * Shared by the component's expand-state key and `findDownstream`'s lookup,
 * so the two never drift apart into two different notions of "identity".
 */
export function symbolKey(symbol: { file: string; name: string }): string {
  return `${symbol.file}:${symbol.name}`;
}

/**
 * The downstream group for a changed symbol — absent when it has no callers.
 * Matches on the exact `(file, name)` pair via `symbolKey`; `DownstreamImpact.file`
 * is required (spec 0012 fix), so there is no name-only fallback to fall back to.
 */
export function findDownstream(
  downstream: DownstreamImpact[],
  symbol: { file: string; name: string },
): DownstreamImpact | undefined {
  const key = symbolKey(symbol);
  return downstream.find((group) => symbolKey({ file: group.file, name: group.symbol }) === key);
}

/**
 * Mirrors `MAX_CALLERS_PER_SYMBOL` (`server/src/modules/repo-intel/constants.ts`)
 * for display only — used solely as the `{count}` in the "capped" note, which
 * only renders when the server-reported `DownstreamImpact.capped` is true
 * (spec 0012): a group at exactly this length is NOT by itself proof of
 * truncation — only the server, which saw the pre-cap count, can say that.
 * Not imported: it is a server module constant, not a shared contract.
 */
export const CALLER_DISPLAY_CAP = 20;
