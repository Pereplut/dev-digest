/** The block the run executor appends to the system prompt for one skill (spec 0006). */
export function renderSkillBlock(name: string, body: string): string {
  return `### Skill: ${name}\n${body}`;
}
