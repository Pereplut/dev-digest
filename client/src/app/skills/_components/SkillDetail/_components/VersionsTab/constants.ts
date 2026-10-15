import type { DiffKind } from "@/lib/text-diff";

/** Gutter marker per diff row kind. */
export const DIFF_MARK: Record<DiffKind, string> = { add: "+", del: "-", same: " " };
