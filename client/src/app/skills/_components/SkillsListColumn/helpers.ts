import type { Skill } from "@devdigest/shared";

/** Case-insensitive filter over a skill's name + description. */
export function filterSkills(skills: Skill[], search: string): Skill[] {
  const q = search.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((sk) => `${sk.name} ${sk.description}`.toLowerCase().includes(q));
}

/** The detail route for a skill, keeping the tab the user is on (read at click time). */
export function skillHref(id: string, currentSearch: string): string {
  const tab = new URLSearchParams(currentSearch).get("tab");
  return tab ? `/skills/${id}?tab=${encodeURIComponent(tab)}` : `/skills/${id}`;
}
