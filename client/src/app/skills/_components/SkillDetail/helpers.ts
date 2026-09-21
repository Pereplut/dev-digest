import { DEFAULT_TAB, VALID_TABS, type SkillTab } from "./constants";

/** Narrow a `?tab=` value to a shipped tab, falling back to the default. */
export function parseTab(raw: string | null | undefined): SkillTab {
  return VALID_TABS.find((tb) => tb === raw) ?? DEFAULT_TAB;
}
