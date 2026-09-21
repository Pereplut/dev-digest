import type { CSSProperties } from "react";

/** Co-located styles for SkillsLabShell. */
export const s = {
  // 52px = the AppFrame top bar (same as the agents editor).
  row: { display: "flex", height: "calc(100vh - 52px)" } satisfies CSSProperties,
  pane: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 } satisfies CSSProperties,
} as const;
