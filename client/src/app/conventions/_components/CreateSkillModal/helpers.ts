/** Pure validation for the create-skill draft. Returns i18n KEYS, never strings. */
import { DRAFT_LIMITS } from "./constants";

export type DraftField = "name" | "description" | "body";

export interface FieldError {
  key: "required" | "tooLong";
  values?: { max: number };
}

export type DraftErrors = Partial<Record<DraftField, FieldError>>;

export interface DraftValues {
  name: string;
  description: string;
  body: string;
}

export function validateDraft(values: DraftValues): DraftErrors {
  const errors: DraftErrors = {};
  for (const field of ["name", "description", "body"] as const) {
    const value = values[field].trim();
    const max = DRAFT_LIMITS[field];
    if (!value) errors[field] = { key: "required" };
    else if (value.length > max) errors[field] = { key: "tooLong", values: { max } };
  }
  return errors;
}

export function hasErrors(errors: DraftErrors): boolean {
  return Object.keys(errors).length > 0;
}
