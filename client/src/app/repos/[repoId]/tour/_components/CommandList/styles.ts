import type { CSSProperties } from "react";

/** Co-located styles for the run_locally command list. */
export const s = {
  list: { margin: "8px 0 0", paddingLeft: 22, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  item: { display: "flex", alignItems: "center", gap: 8, fontSize: 13 } satisfies CSSProperties,
  code: {
    flex: 1,
    minWidth: 0,
    overflowX: "auto",
    padding: "3px 8px",
    borderRadius: 5,
    background: "var(--bg-hover)",
    color: "var(--accent-text)",
  } satisfies CSSProperties,
} as const;
