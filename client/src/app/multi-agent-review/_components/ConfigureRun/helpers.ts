/** Pure helpers for ConfigureRun. */
import type { PrMeta } from "@devdigest/shared";

export interface PrOption {
  id: string;
  number: number;
  title: string;
}

/**
 * Options for the PR select: the active repo's PRs, plus the preselected PR
 * (`?pr=`) when it belongs to another repo and so is not in that list.
 */
export function buildPrOptions(pulls: PrMeta[], extra: PrOption | null): PrOption[] {
  const out: PrOption[] = [];
  for (const p of pulls) if (p.id) out.push({ id: p.id, number: p.number, title: p.title });
  if (extra && !out.some((o) => o.id === extra.id)) out.unshift(extra);
  return out;
}

export function prOptionLabel(o: PrOption): string {
  return `#${o.number} · ${o.title}`;
}

/** Toggle one id in a selection, keeping insertion order. */
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}
