import type { IconName } from "@/components/ui-client";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Editor tabs. Stats/CI stay hidden until built (labels exist in agents.json). */
export const TABS = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  // FlaskConical is the kit's existing icon for the "test" category (tokens.ts
  // CAT.test) — the closest fit to "run this agent's eval harness".
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
] as const satisfies readonly EditorTab[];

export type EditorTabKey = (typeof TABS)[number]["key"];

/** Values accepted from `?tab=` — derived from TABS, never hand-listed. */
export const VALID_TABS: readonly EditorTabKey[] = TABS.map((tb) => tb.key);

export const DEFAULT_TAB: EditorTabKey = "config";
