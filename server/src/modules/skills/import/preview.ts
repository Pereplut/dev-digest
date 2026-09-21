/**
 * Skill import preview (spec 0006): uploaded bytes → a validated `SkillDraft`
 * plus the list of files that were NOT imported. Pure apart from the injected
 * `ArchiveReader`, so it unit-tests without a DB or HTTP.
 *
 * Nothing is persisted and nothing is executed: only the ONE core markdown
 * file is ever inflated and decoded as text; every other entry is merely
 * listed by name with the reason it was skipped.
 */
import { SkillDraft, SkillType } from '@devdigest/shared';
import {
  ArchiveLimitError,
  type ArchiveEntry,
  type ArchiveReader,
} from '../../../adapters/archive/port.js';
import { ValidationError } from '../../../platform/errors.js';
import {
  ARCHIVE_EXTENSIONS,
  CORE_FILE_NAME,
  EXECUTABLE_DIRS,
  EXECUTABLE_EXTENSIONS,
  IGNORE_REASON,
  MARKDOWN_EXTENSIONS,
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_TOTAL_BYTES,
  MAX_SKILL_MD_BYTES,
} from '../constants.js';
import { firstParagraph, nameFromPath } from '../helpers.js';
import { parseSkillMarkdown } from './parse-skill-md.js';

export interface IgnoredFile {
  path: string;
  reason: string;
}

export interface ImportDraftResult {
  draft: SkillDraft;
  /** Path of the file the draft came from (the upload itself for a `.md`). */
  corePath: string;
  ignored_files: IgnoredFile[];
}

function extOf(path: string): string {
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

function isMarkdown(path: string): boolean {
  return (MARKDOWN_EXTENSIONS as readonly string[]).includes(extOf(path));
}

/**
 * A name that must never be treated as a real file: absolute, a drive letter,
 * a backslash (Windows separators hide `..`), a NUL, or any `..` segment.
 */
export function isUnsafeArchivePath(path: string): boolean {
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return true;
  if (path.includes('\\') || path.includes('\0')) return true;
  return path.split('/').some((seg) => seg === '..');
}

/** OS metadata that sometimes rides along in archives (`__MACOSX/`, `._foo`). */
function isOsMetadata(path: string): boolean {
  const segs = path.split('/');
  const base = segs[segs.length - 1] ?? '';
  return segs[0] === '__MACOSX' || base.startsWith('._') || base === '.DS_Store';
}

function isExecutable(path: string): boolean {
  const segs = path.split('/');
  if (segs.slice(0, -1).some((s) => EXECUTABLE_DIRS.has(s.toLowerCase()))) return true;
  return EXECUTABLE_EXTENSIONS.has(extOf(path));
}

/** Pick the core markdown entry or throw a 422 explaining why none fits. */
export function pickCoreEntry(files: ArchiveEntry[]): ArchiveEntry {
  const candidates = files.filter(
    (f) => isMarkdown(f.path) && !isUnsafeArchivePath(f.path) && !isOsMetadata(f.path),
  );
  // SKILL.md at the root or inside ONE top-level folder.
  const skillMd = candidates.filter((f) => {
    const segs = f.path.split('/');
    return segs.length <= 2 && (segs[segs.length - 1] ?? '').toLowerCase() === CORE_FILE_NAME;
  });
  if (skillMd.length > 0) {
    const depth = (f: ArchiveEntry) => f.path.split('/').length;
    const shallowest = Math.min(...skillMd.map(depth));
    const top = skillMd.filter((f) => depth(f) === shallowest);
    if (top.length > 1) {
      throw new ValidationError('Archive contains more than one SKILL.md', {
        files: top.map((f) => f.path),
      });
    }
    return top[0]!;
  }
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) {
    throw new ValidationError('Archive contains no markdown file to import');
  }
  throw new ValidationError(
    'Archive contains several markdown files and no SKILL.md — cannot tell which is the skill',
    { files: candidates.map((f) => f.path) },
  );
}

function reasonFor(path: string): string {
  if (isUnsafeArchivePath(path)) return IGNORE_REASON.unsafePath;
  if (isExecutable(path)) return IGNORE_REASON.executable;
  if (isMarkdown(path) && !isOsMetadata(path)) return IGNORE_REASON.reference;
  return IGNORE_REASON.other;
}

function decodeUtf8(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ValidationError(`${path} is not UTF-8 text`);
  }
}

/**
 * Turn parsed markdown into a candidate draft: frontmatter wins; a missing
 * name comes from the file name, a missing description from the body's first
 * paragraph, a missing/unknown type is `custom`. Validated with `SkillDraft`.
 */
export function draftFromMarkdown(text: string, corePath: string, fallbackName?: string): SkillDraft {
  const { frontmatter, body } = parseSkillMarkdown(text);
  const name = frontmatter.name?.trim() || nameFromPath(corePath, fallbackName);
  const description = frontmatter.description?.trim() || firstParagraph(body);
  const typeParsed = SkillType.safeParse(frontmatter.type?.trim().toLowerCase());
  const candidate = {
    name,
    description,
    type: typeParsed.success ? typeParsed.data : 'custom',
    body,
  };
  const parsed = SkillDraft.safeParse(candidate);
  if (!parsed.success) {
    throw new ValidationError('Imported skill is invalid', parsed.error.issues);
  }
  return parsed.data;
}

/**
 * Build the preview for an uploaded file. `.md` is parsed directly; `.zip` /
 * `.skill` go through the ArchiveReader with the entry-count and size guards.
 */
export function buildImportDraft(
  reader: ArchiveReader,
  filename: string,
  bytes: Uint8Array,
): ImportDraftResult {
  const ext = extOf(filename);
  const archiveBase = (filename.split(/[\\/]/).pop() ?? filename).replace(/\.[^.]+$/, '');

  if ((MARKDOWN_EXTENSIONS as readonly string[]).includes(ext)) {
    if (bytes.length > MAX_SKILL_MD_BYTES) {
      throw new ValidationError(`Markdown file is larger than ${MAX_SKILL_MD_BYTES} bytes`);
    }
    const text = decodeUtf8(bytes, filename);
    return { draft: draftFromMarkdown(text, filename), corePath: filename, ignored_files: [] };
  }

  if (!(ARCHIVE_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new ValidationError('Unsupported file type — upload a .md, .zip or .skill file');
  }

  try {
    const entries = reader.list(bytes, {
      maxEntries: MAX_ARCHIVE_ENTRIES,
      maxTotalBytes: MAX_ARCHIVE_TOTAL_BYTES,
    });
    const files = entries.filter((e) => !e.path.endsWith('/'));
    const core = pickCoreEntry(files);
    const text = decodeUtf8(reader.read(bytes, core.path, MAX_SKILL_MD_BYTES), core.path);
    const ignored_files = files
      .filter((f) => f.path !== core.path)
      .map((f) => ({ path: f.path, reason: reasonFor(f.path) }));
    return {
      draft: draftFromMarkdown(text, core.path, archiveBase),
      corePath: core.path,
      ignored_files,
    };
  } catch (err) {
    if (err instanceof ArchiveLimitError) {
      throw new ValidationError(err.message);
    }
    throw err;
  }
}
