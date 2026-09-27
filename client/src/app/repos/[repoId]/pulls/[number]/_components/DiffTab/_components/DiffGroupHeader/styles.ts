import type { CSSProperties } from "react";

export const s = {
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "10px 4px",
    background: "none",
    border: "none",
    font: "inherit",
    color: "inherit",
    textAlign: "left",
    cursor: "pointer",
  } satisfies CSSProperties,
  label: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  desc: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  findingCount: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    color: "var(--text-secondary)",
    flexShrink: 0,
  } satisfies CSSProperties,
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--crit)",
    display: "inline-block",
  } satisfies CSSProperties,
  fileCount: { fontSize: 12, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
} as const;

export function square(color: string): CSSProperties {
  return { width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 };
}

export function chevron(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}
