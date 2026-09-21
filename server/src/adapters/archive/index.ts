/**
 * fflate implementation of the ArchiveReader port (pure JS, in-memory).
 *
 * Zip-bomb guards:
 * - `list` walks the central directory through `unzipSync`'s `filter` hook and
 *   returns `false` for every entry, so NOTHING is inflated while listing. The
 *   entry-count and declared-size limits are checked there, and it throws as
 *   soon as one is broken.
 * - `read` inflates a single entry. fflate allocates exactly the DECLARED size
 *   (`inflateSync(…, { out: new u8(originalSize) })`) and does not grow a
 *   caller-provided buffer, so an entry that lies about its size cannot
 *   produce more than it declared. The declared size is checked against
 *   `maxBytes` before inflating, and the actual output length is checked after.
 */
import { unzipSync } from 'fflate';
import {
  ArchiveLimitError,
  type ArchiveEntry,
  type ArchiveLimits,
  type ArchiveReader,
} from './port.js';

export { ArchiveLimitError } from './port.js';
export type { ArchiveEntry, ArchiveLimits, ArchiveReader } from './port.js';

export class FflateArchiveReader implements ArchiveReader {
  list(bytes: Uint8Array, limits: ArchiveLimits): ArchiveEntry[] {
    const entries: ArchiveEntry[] = [];
    let total = 0;
    try {
      unzipSync(bytes, {
        filter: (f) => {
          entries.push({ path: f.name, size: f.originalSize });
          if (entries.length > limits.maxEntries) {
            throw new ArchiveLimitError(`Archive has more than ${limits.maxEntries} entries`);
          }
          total += f.originalSize;
          if (total > limits.maxTotalBytes) {
            throw new ArchiveLimitError(
              `Archive expands to more than ${limits.maxTotalBytes} bytes`,
            );
          }
          return false; // never inflate while listing
        },
      });
    } catch (err) {
      if (err instanceof ArchiveLimitError) throw err;
      throw new ArchiveLimitError('Not a valid zip archive');
    }
    return entries;
  }

  read(bytes: Uint8Array, path: string, maxBytes: number): Uint8Array {
    let declared = -1;
    let out: Record<string, Uint8Array>;
    try {
      out = unzipSync(bytes, {
        filter: (f) => {
          if (f.name !== path) return false;
          declared = f.originalSize;
          if (declared > maxBytes) {
            throw new ArchiveLimitError(`Entry ${path} is larger than ${maxBytes} bytes`);
          }
          return true;
        },
      });
    } catch (err) {
      if (err instanceof ArchiveLimitError) throw err;
      throw new ArchiveLimitError('Not a valid zip archive');
    }
    const data = out[path];
    if (!data || declared < 0) throw new ArchiveLimitError(`Entry ${path} not found`);
    if (data.length > maxBytes || data.length > declared) {
      throw new ArchiveLimitError(`Entry ${path} is larger than declared`);
    }
    return data;
  }
}
