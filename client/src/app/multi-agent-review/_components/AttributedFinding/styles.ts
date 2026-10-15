import type { CSSProperties } from "react";

export const s = {
  root: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  label: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  soon: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
};
