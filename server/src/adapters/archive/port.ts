/**
 * ArchiveReader — the PORT for reading an uploaded zip archive (onion ring 2).
 *
 * Used by the skill import preview (spec 0006). `adapters/archive/index.ts` is
 * the only file that imports the zip library; services resolve an
 * implementation from `container.archiveReader`.
 *
 * Contract, which every implementation must honour:
 * - in-memory only: nothing is written to disk and nothing is executed;
 * - `list` reads the central directory WITHOUT inflating anything, so the
 *   caller can apply entry-count / declared-size guards before paying for
 *   decompression;
 * - `read` inflates ONE entry, and never yields more than `maxBytes`;
 * - malformed input or a broken limit throws `ArchiveLimitError`, never a
 *   library-specific error, so callers can map it to a 4xx.
 */

export interface ArchiveEntry {
  /** Path inside the archive, as stored (forward slashes). Directories end in `/`. */
  path: string;
  /** Declared uncompressed size, from the central directory. */
  size: number;
}

export interface ArchiveLimits {
  /** Maximum number of entries (files + directories). */
  maxEntries: number;
  /** Maximum total declared uncompressed size, in bytes. */
  maxTotalBytes: number;
}

export interface ArchiveReader {
  /** List entries; throws `ArchiveLimitError` if the archive is invalid or breaks `limits`. */
  list(bytes: Uint8Array, limits: ArchiveLimits): ArchiveEntry[];
  /** Inflate one entry by exact path; throws `ArchiveLimitError` if missing or larger than `maxBytes`. */
  read(bytes: Uint8Array, path: string, maxBytes: number): Uint8Array;
}

/** Invalid archive or a broken limit. Carries no library internals. */
export class ArchiveLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveLimitError';
  }
}
