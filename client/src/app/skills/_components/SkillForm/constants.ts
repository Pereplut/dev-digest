import type { SkillType } from "@devdigest/shared";

/**
 * Selectable skill types. Mirrors the shared `SkillType` enum by hand: the
 * client may only take TYPES from `@devdigest/shared` — a runtime import pulls
 * the vendored barrel, whose `.js` specifiers webpack cannot resolve. The
 * `satisfies` + test keep this list honest.
 */
export const TYPE_OPTIONS = ["rubric", "convention", "security", "custom"] as const satisfies readonly SkillType[];

/** SkillDraft limits (server/src/vendor/shared/contracts/knowledge.ts), mirrored for the same reason. */
export const DRAFT_LIMITS = { name: 80, description: 500, body: 20_000, message: 200 } as const;

/** Server statuses whose message is shown inline on the form (validation / name conflict). */
export const INLINE_ERROR_STATUSES = [409, 422] as const;

export const BODY_ROWS = 16;
