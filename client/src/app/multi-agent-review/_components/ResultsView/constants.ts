/** Constants for ResultsView. */

/** The two ways to lay the same run out. Local state — not a URL param. */
export const VIEWS = ["columns", "tabs"] as const;
export type View = (typeof VIEWS)[number];
