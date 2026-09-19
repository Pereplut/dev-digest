import type { SkillImportPreview } from "@devdigest/shared";

/** Server reasons for scripts/binaries mention "executable"; those rows are highlighted. */
export function isExecutableReason(reason: string): boolean {
  return /executable/i.test(reason);
}

/** A conflicting name must be changed before the import can be confirmed. */
export function nameBlocked(preview: SkillImportPreview, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  return preview.name_conflict && trimmed === preview.draft.name.trim();
}
