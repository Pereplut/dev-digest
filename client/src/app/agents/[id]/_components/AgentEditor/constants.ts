import type { IconName } from "@/components/ui-client";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Editor tabs. Stats/CI stay hidden until built (labels exist in agents.json). */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  // FlaskConical is the kit's existing icon for the "test" category (tokens.ts
  // CAT.test) — the closest fit to "run this agent's eval harness".
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
];
