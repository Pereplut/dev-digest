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

/** The downstream group for a changed symbol, matched by name — absent when it has no callers. */
export function findDownstream(
  downstream: DownstreamImpact[],
  symbolName: string,
): DownstreamImpact | undefined {
  return downstream.find((group) => group.symbol === symbolName);
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
