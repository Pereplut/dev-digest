/** Skill detail tabs (design tab_3–5). `shipped: false` tabs keep their i18n
    keys but are not rendered until built (spec 0006 decision 5), like the
    "Run on evals" header action. */
export const TABS = [
  { key: "config", labelKey: "detail.tabs.config", shipped: true },
  { key: "context", labelKey: "detail.tabs.context", shipped: false },
  { key: "preview", labelKey: "detail.tabs.preview", shipped: true },
  { key: "evals", labelKey: "detail.tabs.evals", shipped: false },
  { key: "stats", labelKey: "detail.tabs.stats", shipped: true },
  { key: "versions", labelKey: "detail.tabs.versions", shipped: true },
] as const;

type TabDescriptor = (typeof TABS)[number];
export type SkillTab = Extract<TabDescriptor, { shipped: true }>["key"];

export const SHIPPED_TABS = TABS.filter((tb): tb is Extract<TabDescriptor, { shipped: true }> => tb.shipped);

/** Values accepted from `?tab=`. */
export const VALID_TABS: readonly SkillTab[] = SHIPPED_TABS.map((tb) => tb.key);

export const DEFAULT_TAB: SkillTab = "preview";
