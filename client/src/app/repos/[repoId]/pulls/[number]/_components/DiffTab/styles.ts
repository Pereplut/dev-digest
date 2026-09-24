import type { CSSProperties } from "react";

export const s = {
  /** The controls in the SectionLabel's right slot: visibility, then order. */
  toolbar: { display: "inline-flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
} as const;
