/** Constants for the skills module (spec 0006). */

/** Version a newly created skill starts at. */
export const INITIAL_SKILL_VERSION = 1;

// ---- Import preview limits ------------------------------------------------

/** Multipart upload cap for `POST /skills/import/preview`. */
export const MAX_IMPORT_UPLOAD_BYTES = 1_048_576; // 1 MB
/** Zip-bomb guard: maximum number of archive entries. */
export const MAX_ARCHIVE_ENTRIES = 200;
/** Zip-bomb guard: maximum total DECLARED uncompressed size. */
export const MAX_ARCHIVE_TOTAL_BYTES = 2 * 1_048_576; // 2 MB
/** Largest markdown file read as the skill core (the body is capped at 20k chars anyway). */
export const MAX_SKILL_MD_BYTES = 256 * 1024;

/** Upload kinds accepted by the import preview, by extension. */
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown'] as const;
export const ARCHIVE_EXTENSIONS = ['.zip', '.skill'] as const;

/** The conventional name of an archive's core file (matched case-insensitively). */
export const CORE_FILE_NAME = 'skill.md';

/** Why an archive entry was not imported — shown verbatim in the preview. */
export const IGNORE_REASON = {
  reference: 'reference file — not imported',
  executable: 'executable — not processed',
  unsafePath: 'unsafe path — not imported',
  other: 'not imported',
} as const;

/**
 * Extensions treated as scripts/binaries. They are NEVER read or run; the
 * preview only lists them so the user sees what the archive carried.
 */
export const EXECUTABLE_EXTENSIONS = new Set([
  '.sh', '.bash', '.zsh', '.fish', '.py', '.pyc', '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts',
  '.rb', '.pl', '.php', '.ps1', '.bat', '.cmd', '.exe', '.bin', '.dll', '.so', '.dylib',
  '.jar', '.class', '.wasm', '.app', '.msi', '.deb', '.rpm', '.apk', '.elf', '.out', '.o',
  '.go', '.rs', '.c', '.cpp', '.lua', '.swift', '.kt',
]);

/** Directory names whose contents are always treated as executable. */
export const EXECUTABLE_DIRS = new Set(['scripts', 'bin']);

/** Max characters of a derived (frontmatter-less) description. */
export const DERIVED_DESCRIPTION_MAX = 280;
/** Max characters of a derived name (SkillDraft allows 80). */
export const DERIVED_NAME_MAX = 80;

/** Fallback name when neither frontmatter nor a filename yields one. */
export const FALLBACK_SKILL_NAME = 'imported-skill';

/** Change note stored on a version created by Restore. */
export const restoredMessage = (version: number): string => `Restored v${version}`;
