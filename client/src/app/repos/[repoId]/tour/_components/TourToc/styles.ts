import type { CSSProperties } from "react";

/** Co-located styles for the tour's table of contents. */
export const s = {
  /* `hidden md:block` (AC-72): below the Tailwind `md` breakpoint (768px) the
     TOC is not displayed at all — asserted on the class list, not a viewport. */
  nav: {
    width: 200,
    flexShrink: 0,
    position: "sticky",
    top: 24,
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  link: {
    display: "block",
    padding: "7px 10px",
    borderRadius: 6,
    fontSize: 13,
    color: "var(--text-secondary)",
    textDecoration: "none",
  } satisfies CSSProperties,
} as const;
