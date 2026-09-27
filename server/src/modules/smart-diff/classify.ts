import type { SmartDiffRole } from '@devdigest/shared';
import { CLASSIFY_RULES, FALLBACK_ROLE } from './constants.js';

/**
 * File-role classifier (pure — no DB, no network, no `this`, no HTTP).
 *
 * Deliberately independent of the route: L08 reuses it as a filter before prompt
 * assembly, so it must stay importable and callable with nothing but a string.
 * The rule table and its order live in `constants.ts`.
 */

/**
 * Repo-relative POSIX form. GitHub sends that already, but in-process callers may
 * not, and a leading `./` or `/` would break every root-anchored rule.
 *
 * Diff-header prefixes (`a/`, `b/`) are NOT stripped here: a repo may legitimately
 * have a top-level `a/` directory, and silently eating it would misfile real code.
 * A caller holding diff headers strips them before calling.
 */
export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '');
}

/** The role a path plays in a change. First matching rule wins; see constants.ts. */
export function classifyFile(path: string): SmartDiffRole {
  const p = normalizePath(path);
  for (const rule of CLASSIFY_RULES) {
    if (rule.re.test(p)) return rule.role;
  }
  return FALLBACK_ROLE;
}
