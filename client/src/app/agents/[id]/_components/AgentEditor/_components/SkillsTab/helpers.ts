import type { AgentSkill, Skill } from "@devdigest/shared";

/**
 * One row of the agent Skills tab: a workspace skill plus its link state.
 * `linked` rows always come first, contiguous, in prompt order; unlinked rows
 * follow alphabetically. `enabled` is the per-agent link flag (false when
 * unlinked).
 */
export interface SkillRowModel {
  skill: Skill;
  linked: boolean;
  enabled: boolean;
}

/** Payload item of `PUT /agents/:id/skills` (array order = prompt order). */
export interface SkillLinkPayload {
  skill_id: string;
  enabled: boolean;
}

/**
 * Merge the agent's links with every workspace skill: linked skills first in
 * link order, then the unlinked ones by name. The workspace copy of a skill
 * wins over the one embedded in the link (it is the fresher list query).
 */
export function mergeSkillRows(links: readonly AgentSkill[], skills: readonly Skill[]): SkillRowModel[] {
  const byId = new Map(skills.map((sk) => [sk.id, sk]));
  const linked = [...links]
    .sort((a, b) => a.order - b.order)
    .map((l) => ({ skill: byId.get(l.skill_id) ?? l.skill, linked: true, enabled: l.enabled }));
  const linkedIds = new Set(links.map((l) => l.skill_id));
  const unlinked = skills
    .filter((sk) => !linkedIds.has(sk.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((sk) => ({ skill: sk, linked: false, enabled: false }));
  return [...linked, ...unlinked];
}

/** A row's checkbox state: linked and switched on for this agent. */
export function isChecked(row: SkillRowModel): boolean {
  return row.linked && row.enabled;
}

/** Checked AND globally enabled — the only rows that actually reach the prompt. */
export function reachesPrompt(row: SkillRowModel): boolean {
  return isChecked(row) && row.skill.enabled;
}

/**
 * Check/uncheck one skill.
 * - linked row: flips the link's `enabled`, keeping its position;
 * - unlinked row, checked: becomes linked+enabled at the END of the linked group;
 * - unlinked row, unchecked: no-op.
 */
export function toggleSkill(rows: readonly SkillRowModel[], skillId: string, checked: boolean): SkillRowModel[] {
  const row = rows.find((r) => r.skill.id === skillId);
  if (!row) return [...rows];
  if (row.linked) return rows.map((r) => (r === row ? { ...r, enabled: checked } : r));
  if (!checked) return [...rows];
  const rest = rows.filter((r) => r !== row);
  const firstUnlinked = rest.findIndex((r) => !r.linked);
  const at = firstUnlinked === -1 ? rest.length : firstUnlinked;
  return [...rest.slice(0, at), { ...row, linked: true, enabled: true }, ...rest.slice(at)];
}

/**
 * Move a LINKED row onto another linked row's position. Only linked rows are
 * sortable (an unlinked skill has no prompt position yet — check it first), so
 * a move involving an unlinked row is a no-op.
 */
export function moveSkill(rows: readonly SkillRowModel[], fromId: string, toId: string): SkillRowModel[] {
  const from = rows.findIndex((r) => r.skill.id === fromId);
  const to = rows.findIndex((r) => r.skill.id === toId);
  const moving = rows[from];
  if (!moving?.linked || !rows[to]?.linked || from === to) return [...rows];
  const next = rows.filter((_, i) => i !== from);
  next.splice(to, 0, moving);
  return next;
}

/** The full ordered link list sent to `useSetAgentSkills`. */
export function toPayload(rows: readonly SkillRowModel[]): SkillLinkPayload[] {
  return rows.filter((r) => r.linked).map((r) => ({ skill_id: r.skill.id, enabled: r.enabled }));
}

/** The `["agent-skills", agentId]` cache value for an optimistic update. */
export function toAgentSkills(agentId: string, rows: readonly SkillRowModel[]): AgentSkill[] {
  return rows
    .filter((r) => r.linked)
    .map((r, order) => ({ agent_id: agentId, skill_id: r.skill.id, order, enabled: r.enabled, skill: r.skill }));
}

/** Header count: skills that reach the prompt. */
export function countEnabled(rows: readonly SkillRowModel[]): number {
  return rows.filter(reachesPrompt).length;
}

/** Footer estimate: tokens the prompt-reaching skills add (unknown counts as 0). */
export function sumTokens(rows: readonly SkillRowModel[]): number {
  return rows.filter(reachesPrompt).reduce((sum, r) => sum + (r.skill.token_count ?? 0), 0);
}

/** Case-insensitive filter over name + description. */
export function filterRows(rows: readonly SkillRowModel[], query: string): SkillRowModel[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((r) => r.skill.name.toLowerCase().includes(q) || r.skill.description.toLowerCase().includes(q));
}
