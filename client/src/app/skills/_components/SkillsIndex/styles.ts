import type { CSSProperties } from "react";

/** Co-located styles for SkillsIndex. */
export const s = {
  pad: { padding: 28, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  empty: { flex: 1, display: "grid", placeItems: "center" } satisfies CSSProperties,
  actions: { display: "flex", justifyContent: "center", gap: 10 } satisfies CSSProperties,
} as const;
