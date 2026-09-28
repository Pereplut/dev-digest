/**
 * Blast radius limits — re-exported from `repo-intel/constants.ts`, the single
 * source of truth. This module declares no new magic number (spec 0012 AC 11):
 *   - `MAX_CALLERS_PER_SYMBOL`: the per-`viaSymbol` caller cap the helper
 *     re-applies so it is correct in isolation, unit-testable without the
 *     facade.
 *   - `BFS_DEPTH`: documents the traversal depth the facade already computes
 *     (one hop); this module does not re-implement any traversal.
 */
export { MAX_CALLERS_PER_SYMBOL, BFS_DEPTH } from '../repo-intel/constants.js';
