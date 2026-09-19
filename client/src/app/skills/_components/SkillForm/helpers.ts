import type { Skill, SkillDraft } from "@devdigest/shared";
import { DRAFT_LIMITS, TYPE_OPTIONS } from "./constants";

export type DraftField = keyof SkillDraft;

/** An i18n key under `skills.form.errors.*` plus its values. */
export interface FieldError {
  key: "required" | "tooLong" | "invalid";
  values?: { max: number };
}

export type DraftErrors = Partial<Record<DraftField, FieldError>>;

/**
 * Validate with the same limits the server's SkillDraft applies (trimmed,
 * required, max length). Returns the trimmed draft when valid.
 */
export function validateDraft(input: SkillDraft): { draft: SkillDraft | null; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const trimmed: SkillDraft = {
    name: input.name.trim(),
    description: input.description.trim(),
    type: input.type,
    body: input.body.trim(),
    ...(input.message !== undefined ? { message: input.message.trim() } : {}),
  };
  for (const field of ["name", "description", "body"] as const) {
    if (!trimmed[field]) errors[field] = { key: "required" };
    else if (trimmed[field].length > DRAFT_LIMITS[field]) {
      errors[field] = { key: "tooLong", values: { max: DRAFT_LIMITS[field] } };
    }
  }
  if ((trimmed.message?.length ?? 0) > DRAFT_LIMITS.message) {
    errors.message = { key: "tooLong", values: { max: DRAFT_LIMITS.message } };
  }
  if (!(TYPE_OPTIONS as readonly string[]).includes(trimmed.type)) errors.type = { key: "invalid" };
  return Object.keys(errors).length ? { draft: null, errors } : { draft: trimmed, errors };
}

/** Form values for an existing skill, or empty values for a new one. */
export function initialValues(skill?: Skill): SkillDraft {
  return {
    name: skill?.name ?? "",
    description: skill?.description ?? "",
    type: skill?.type ?? "custom",
    body: skill?.body ?? "",
    message: "",
  };
}

/** Drop an empty change note so it is not stored as "". */
export function withoutEmptyMessage(draft: SkillDraft): SkillDraft {
  const { message, ...rest } = draft;
  return message ? { ...rest, message } : rest;
}
