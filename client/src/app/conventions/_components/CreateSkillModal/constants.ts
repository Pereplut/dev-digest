import type { SkillType } from "@devdigest/shared";

/**
 * Selectable skill types. Mirrors the shared `SkillType` enum by hand: the
 * client may only take TYPES from `@devdigest/shared`, because a runtime import
 * pulls the vendored barrel whose `.js` specifiers webpack cannot resolve.
 * `satisfies` keeps the list honest against the type.
 */
export const TYPE_OPTIONS = [
  "rubric",
  "convention",
  "security",
  "custom",
] as const satisfies readonly SkillType[];

/** ConventionSkillDraft limits, mirrored from the contract for the same reason. */
export const DRAFT_LIMITS = { name: 80, description: 500, body: 20_000 } as const;

export const BODY_ROWS = 16;

/**
 * There is no tokenizer in the client, and the real count is computed server-side
 * on save. This is the same heuristic the server's tokenizer falls back to, so
 * the live figure in the modal is labelled "≈".
 */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
