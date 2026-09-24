import type { SmartDiffRole } from "@/lib/types";

/**
 * Role presentation for the Files changed tab.
 *
 * The role ORDER is the server's (`modules/smart-diff/constants.ts` ROLE_ORDER) —
 * groups arrive already ordered and are rendered as they come, so there is no
 * second sort here to drift from it.
 *
 * NOTE these are plain locals, not the `SmartDiffRole` Zod enum: importing a
 * VALUE from `@devdigest/shared` passes typecheck and vitest and then breaks
 * `next build`, because the vendored barrel re-exports with `.js` specifiers
 * webpack cannot resolve (client/INSIGHTS.md, 2026-09-16).
 */

/** Which order the Files changed tab renders in; mirrored in the `?order=` param. */
export type DiffOrder = "smart" | "original";

/**
 * Roles a reviewer rarely needs open — collapsed on arrival (spec 0010, AC 2).
 * Typed as the role union, not `string[]`: a typo would otherwise compile and
 * make `COLLAPSED_ROLES.includes(role)` silently always false.
 */
export const COLLAPSED_ROLES: readonly SmartDiffRole[] = ["docs", "boilerplate"];

/** i18n key per role, under the `prReview.smartDiff` namespace. */
export const ROLE_LABEL_KEY: Record<SmartDiffRole, string> = {
  core: "coreLabel",
  tests: "testsLabel",
  wiring: "wiringLabel",
  docs: "docsLabel",
  boilerplate: "boilerplateLabel",
};

export const ROLE_DESC_KEY: Record<SmartDiffRole, string> = {
  core: "coreDesc",
  tests: "testsDesc",
  wiring: "wiringDesc",
  docs: "docsDesc",
  boilerplate: "boilerplateDesc",
};

/** The square that precedes a role label, echoing the severity-free palette. */
export const ROLE_COLOR: Record<SmartDiffRole, string> = {
  core: "var(--accent)",
  tests: "var(--ok, var(--text-secondary))",
  wiring: "var(--warn)",
  docs: "var(--text-secondary)",
  boilerplate: "var(--text-muted)",
};
