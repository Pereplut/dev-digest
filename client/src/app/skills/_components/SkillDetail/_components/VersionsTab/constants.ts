import type { DiffKind } from "./helpers";

/** Gutter marker per diff row kind. */
export const DIFF_MARK: Record<DiffKind, string> = { add: "+", del: "-", same: " " };
