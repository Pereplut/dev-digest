/** Donut colour per finding category; unknown categories cycle through FALLBACK_COLORS. */
export const CATEGORY_COLOR: Record<string, string> = {
  security: "#ef4444",
  bug: "#f59e0b",
  perf: "#8b5cf6",
  style: "#3b82f6",
  test: "#10b981",
};

export const FALLBACK_COLORS = ["#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6b7280"] as const;

export const DONUT_SIZE = 150;
export const DONUT_STROKE = 24;
