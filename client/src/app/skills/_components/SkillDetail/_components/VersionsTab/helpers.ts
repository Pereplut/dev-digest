import type { SkillVersion } from "@devdigest/shared";

// `DiffKind`/`DiffRow`/`toDiffRows` moved to `@/lib/text-diff` (spec 0020,
// AC-55/AC-68) — the compare modal is a second consumer, so the helper has
// exactly one definition, imported from there by both features.

/** Newest first. */
export function sortVersions(versions: SkillVersion[]): SkillVersion[] {
  return [...versions].sort((a, b) => b.version - a.version);
}

/** yyyy-mm-dd from an ISO timestamp. */
export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
