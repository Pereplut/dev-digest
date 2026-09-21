import { diffLines } from "diff";
import type { SkillVersion } from "@devdigest/shared";

export type DiffKind = "add" | "del" | "same";
export interface DiffRow {
  kind: DiffKind;
  text: string;
}

/** Line diff of an older body against the current one, one row per line. */
export function toDiffRows(older: string, current: string): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const part of diffLines(older, current)) {
    const kind: DiffKind = part.added ? "add" : part.removed ? "del" : "same";
    const lines = part.value.replace(/\n$/, "").split("\n");
    for (const text of lines) rows.push({ kind, text });
  }
  return rows;
}

/** Newest first. */
export function sortVersions(versions: SkillVersion[]): SkillVersion[] {
  return [...versions].sort((a, b) => b.version - a.version);
}

/** yyyy-mm-dd from an ISO timestamp. */
export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
