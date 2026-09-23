/**
 * Reading a file out of a repository clone, safely.
 *
 * Two callers with the same threat model share this: the conventions extractor
 * probes config files by name (spec 0007), and the intent layer reads a spec a
 * PR description links to (spec 0008). In both, the PATH comes from somewhere
 * untrusted — a model's output, or a pull request body written by whoever opened
 * it — so the guards below are the boundary, not a formality.
 *
 * Ring: platform. Imports `node:*` only; no module, no container.
 */
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';

/**
 * Reject a path that would escape the clone root. The caller supplies these
 * strings from untrusted input, so `../../etc/passwd` is a realistic input, not
 * a hypothetical.
 *
 * This vets the STRING only. It says nothing about what the path resolves to on
 * disk — that is `readTextFileInClone`'s job, and the reason the two must stay
 * together.
 */
export function isSafeRelativePath(path: string): boolean {
  if (!path || isAbsolute(path) || path.includes('\0')) return false;
  const normalized = normalize(path).replace(/\\/g, '/');
  return !normalized.startsWith('../') && normalized !== '..';
}

/**
 * Read a repo file, returning null instead of throwing when it is missing,
 * unsafe or too large. `GitClient.readFile` throws on ENOENT, and probing for a
 * file that may not exist is the common case for both callers.
 *
 * SECURITY — "inside the clone root" is not a safety boundary on its own:
 *  - `isSafeRelativePath` only vets the string. `readFile` follows symlinks, so
 *    a repository that commits `tsconfig.json` as a link to `../../../.env`, or
 *    to another clone's `.git/config`, would have that file read, put in a
 *    prompt and shipped to the model provider. Config names are probed by name,
 *    so an attacker only has to commit the link.
 *  - `.git/` is excluded outright: it holds the credential the clone URL carried
 *    (see platform/redact.ts) and is never repository source.
 *
 * `lstat` — not `stat` — is what makes the first check work: it does not follow
 * the link, so `isFile()` is false for one. The realpath check then also covers
 * a link in a *directory component* of the path.
 *
 * @param maxBytes refuse a file larger than this. Callers apply their own
 * character budgets AFTER the read, so without this the whole file is resident
 * in the API process first — a repo need only commit one huge file to exhaust
 * the heap of the process serving every other request.
 */
export async function readTextFileInClone(
  clonePath: string,
  relPath: string,
  maxBytes: number,
): Promise<string | null> {
  if (!isSafeRelativePath(relPath)) return null;

  const root = resolve(clonePath);
  const full = resolve(root, relPath);
  if (full === root || !full.startsWith(root + sep)) return null;

  const stats = await lstat(full).catch(() => null);
  if (!stats?.isFile()) return null;
  if (stats.size > maxBytes) return null;

  const real = await realpath(full).catch(() => null);
  if (real === null || !real.startsWith(root + sep)) return null;
  if (relative(root, real).split(sep)[0] === '.git') return null;

  return readFile(full, 'utf8').catch(() => null);
}
