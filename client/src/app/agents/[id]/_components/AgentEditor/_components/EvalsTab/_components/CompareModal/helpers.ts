import type { DiffRow } from "@/lib/text-diff";

/** True if any diff row is a real change — the "no prompt change" branch (AC-59). */
export function hasPromptChange(rows: readonly DiffRow[]): boolean {
  return rows.some((r) => r.kind !== "same");
}
