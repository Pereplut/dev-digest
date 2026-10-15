/** Pure helpers for AgentPicker. */

/** Toggle one id in a selection, keeping insertion order. */
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** `/multi-agent-review?new=1&pr=<prId>` — the Configure run page, PR preselected. */
export function configureHref(prId: string): string {
  return `/multi-agent-review?new=1&pr=${encodeURIComponent(prId)}`;
}
