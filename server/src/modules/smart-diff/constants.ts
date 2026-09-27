import type { SmartDiffRole } from '@devdigest/shared';

/**
 * Smart Diff role taxonomy — the patterns AND the order they are matched in.
 *
 * Two orders live here and they are deliberately different:
 *  - ROLE_ORDER is how groups are DISPLAYED (what a reviewer should read first).
 *  - CLASSIFY_RULES is how a path is MATCHED. First rule that matches wins, so
 *    the rule order is the actual decision — a snapshot inside `__tests__/` is
 *    boilerplate because the snapshot rule sits above the test rule, and a
 *    markdown file under `.claude/` is wiring because it configures an agent
 *    rather than documenting anything.
 *
 * Spec: specs/0010-smart-diff.md (decision 3).
 */

/** Display order: the substance of the change first, mechanical noise last. */
export const ROLE_ORDER = ['core', 'tests', 'wiring', 'docs', 'boilerplate'] as const satisfies
  readonly SmartDiffRole[];

/** Groups a reviewer rarely needs open; the UI collapses these by default. */
export const COLLAPSED_ROLES: readonly SmartDiffRole[] = ['docs', 'boilerplate'];

/**
 * Evaluated top to bottom; the first match wins and there is no tie-break.
 * Directory rules match at ANY depth (`server/dist/**` must not read as core in
 * this very repo); `e2e/` is the one exception — here it is a package name, so
 * it is anchored at the root.
 */
export const CLASSIFY_RULES: readonly { role: SmartDiffRole; re: RegExp }[] = [
  // --- boilerplate: generated or mechanical, skim at most ---
  { role: 'boilerplate', re: /\.lock$/ },
  { role: 'boilerplate', re: /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/ },
  { role: 'boilerplate', re: /(^|\/)(dist|build)\// },
  { role: 'boilerplate', re: /(^|\/)__snapshots__\// },
  { role: 'boilerplate', re: /\.snap$/ },
  { role: 'boilerplate', re: /\.generated\./ },
  { role: 'boilerplate', re: /\.min\.js$/ },

  // --- tests ---
  { role: 'tests', re: /\.(test|spec)\.[cm]?[jt]sx?$/ },
  { role: 'tests', re: /(^|\/)(test|tests|__tests__)\// },
  { role: 'tests', re: /^e2e\// },

  // --- wiring: hooks the core into the app ---
  { role: 'wiring', re: /(^|\/)index\.[cm]?[jt]sx?$/ },
  { role: 'wiring', re: /\.config\.[^/]+$/ },
  { role: 'wiring', re: /(^|\/)tsconfig[^/]*\.json$/ },
  { role: 'wiring', re: /(^|\/)\.eslintrc[^/]*$/ },
  { role: 'wiring', re: /(^|\/)\.env[^/]*$/ },
  { role: 'wiring', re: /(^|\/)docker-compose[^/]*\.ya?ml$/ },
  { role: 'wiring', re: /(^|\/)\.github\// },
  { role: 'wiring', re: /(^|\/)\.claude\// },

  // --- docs ---
  { role: 'docs', re: /\.md$/ },
  { role: 'docs', re: /(^|\/)docs\// },
  { role: 'docs', re: /(^|\/)README[^/]*$/i },
  { role: 'docs', re: /(^|\/)CHANGELOG[^/]*$/i },
  { role: 'docs', re: /(^|\/)LICENSE[^/]*$/i },
];

/** Everything that matched no rule. */
export const FALLBACK_ROLE: SmartDiffRole = 'core';
