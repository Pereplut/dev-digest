"use client";

/**
 * Client boundary for the vendored design system.
 *
 * `src/vendor/ui` uses hooks (useState/useEffect/…) in 10 modules but declares
 * no `"use client"` directive, because it is vendored code we do not edit (see
 * the root AGENTS.md "Do not touch" list). Without a directive the kit cannot
 * be imported from a Server Component at all, and every consumer has to declare
 * the boundary itself.
 *
 * This module is that boundary, declared ONCE in first-party code: import the
 * design system from here rather than from `@devdigest/ui` directly, and the
 * directive travels with it. Nothing in `src/vendor/ui` changes, so a re-vendor
 * cannot silently drop the fix.
 *
 * Enforced by the `no-restricted-imports` rule in `eslint.config.mjs`, which
 * allows `@devdigest/ui` only inside this file.
 */
export * from "@devdigest/ui";
