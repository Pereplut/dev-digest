/* text-diff.ts — line-level diff of two strings. Promoted out of
   VersionsTab/helpers.ts (spec 0020, AC-55/AC-68) because the compare modal
   needed the same helper for a system-prompt diff: one definition, imported
   by both the skills VersionsTab and the agents eval compare modal, so the
   `agents` feature never imports from the `skills` feature. */
import { diffLines } from "diff";

export type DiffKind = "add" | "del" | "same";
export interface DiffRow {
  kind: DiffKind;
  text: string;
}

/** Line diff of an older string against a current one, one row per line. */
export function toDiffRows(older: string, current: string): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const part of diffLines(older, current)) {
    const kind: DiffKind = part.added ? "add" : part.removed ? "del" : "same";
    const lines = part.value.replace(/\n$/, "").split("\n");
    for (const text of lines) rows.push({ kind, text });
  }
  return rows;
}
