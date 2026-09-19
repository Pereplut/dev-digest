import { CATEGORY_COLOR, FALLBACK_COLORS } from "./constants";

export interface CategorySlice {
  category: string;
  count: number;
  color: string;
}

/** Non-empty categories, largest first, each with a stable colour. */
export function toSlices(rows: { category: string; count: number }[]): CategorySlice[] {
  let fallback = 0;
  return rows
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((r) => ({
      ...r,
      color: CATEGORY_COLOR[r.category] ?? FALLBACK_COLORS[fallback++ % FALLBACK_COLORS.length] ?? "var(--text-muted)",
    }));
}
