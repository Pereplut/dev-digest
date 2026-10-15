import { DEFAULT_TAB, VALID_TABS, type EditorTabKey } from "./constants";

/** Narrow a `?tab=` value to an editor tab, falling back to the default. */
export function parseTab(raw: string | null | undefined): EditorTabKey {
  return VALID_TABS.find((tb) => tb === raw) ?? DEFAULT_TAB;
}
