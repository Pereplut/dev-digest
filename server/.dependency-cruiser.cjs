/**
 * Architecture rules for @devdigest/api — the onion rings from
 * `.claude/skills/onion-architecture/SKILL.md`. Run: `pnpm arch` (folded into `pnpm lint`).
 *
 * Paths are RESOLVED REGEX, not globs, relative to this package root.
 *
 * `pathNot` exclusions below quarantine the KNOWN DEVIATIONS listed in SKILL.md §11. They are
 * scoped per-rule on purpose: a global `exclude` would also hide those files from the cycle and
 * cross-module checks. Fixing a deviation means deleting its exclusion here AND its entry there.
 */
module.exports = {
  forbidden: [
    {
      name: 'routes-no-drizzle',
      comment:
        'routes.ts is transport only (onion ring 4): parse, getContext, call the service, set the ' +
        'status. Move the query into repository/<entity>.repo.ts. ' +
        'Excluded: polling/workspace/settings have no service yet — SKILL.md §11 deviation 1. ' +
        '(pulls was extracted in B1 and is now held to the rule.)',
      severity: 'error',
      from: {
        path: '^src/modules/[^/]+/routes\\.ts$',
        pathNot: '^src/modules/(polling|workspace|settings)/',
      },
      to: { path: '^(node_modules/drizzle-orm|src/db/schema)' },
    },
    {
      name: 'service-no-sdk',
      comment:
        'Application services (ring 3) reach external systems through a container port, never a ' +
        'vendor SDK. No port yet? Add one — SKILL.md §6.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/(service|run-executor)\\.ts$' },
      to: { path: '^node_modules/(octokit|openai|@anthropic-ai|simple-git|@ast-grep)' },
    },
    {
      name: 'drizzle-only-in-repositories',
      comment:
        'Only the data layer imports drizzle-orm: repository.ts and repository/*.repo.ts. ' +
        'Excluded: the three remaining service-less modules, and settings/feature-models.ts — ' +
        'SKILL.md §11. (pulls was extracted in B1 and is now held to the rule.)',
      severity: 'error',
      from: {
        path: '^src/modules/',
        pathNot:
          '^(src/modules/[^/]+/repository|src/modules/(polling|workspace|settings)/)',
      },
      to: { path: '^node_modules/drizzle-orm' },
    },
    {
      name: 'adapters-no-modules',
      comment:
        'Adapters (ring 4 infrastructure) must not import feature modules — that is an inner ring ' +
        'depending on an outer one. Excluded: astgrep + depgraph import repo-intel/constants, ' +
        'auth/local imports db/seed — SKILL.md §11 deviation 2.',
      severity: 'error',
      from: { path: '^src/adapters/', pathNot: '^src/adapters/(astgrep|depgraph|auth)/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'astgrep-only-through-its-port',
      comment:
        'Feature modules depend on the CodeParser PORT (adapters/astgrep/port.ts), never on the ' +
        'implementation that imports @ast-grep/napi. Resolve it from `container.codeParser`. ' +
        'SKILL.md §6 names ast-grep as the cautionary example of an external system smuggled in ' +
        'without a port; this rule is what keeps it fixed. `tsPreCompilationDeps` is on, so an ' +
        '`import type` from the implementation trips this too.',
      severity: 'error',
      from: { path: '^src/modules/' },
      to: { path: '^src/adapters/astgrep/index\\.ts$' },
    },
    {
      name: 'platform-no-modules',
      comment:
        'platform/** is cross-cutting infrastructure and must not import feature modules. ' +
        'Excluded: container.ts is the composition root and is allowed to wire them — ' +
        'SKILL.md §11 deviation 3.',
      severity: 'error',
      from: { path: '^src/platform/', pathNot: '^src/platform/container\\.ts$' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'no-cross-module-internals',
      comment:
        "A module must not import another module's service or repository. Use the container " +
        '(container.agentsRepo, container.reviewRepo) or db/rows.ts for shared row shapes.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/[^/]+/(service|repository)',
        pathNot: '^src/modules/$1/',
      },
    },
    {
      name: 'core-stays-pure',
      comment:
        'reviewer-core is the domain core (ring 1): no DB, no GitHub, no filesystem. Its only side ' +
        'effect is the injected LLMProvider.',
      severity: 'error',
      from: { path: '^[.][.]/reviewer-core/src/' },
      to: { path: '^(node_modules/(drizzle-orm|postgres|octokit|simple-git)|src/db/)' },
    },
    {
      name: 'contracts-import-nothing-outward',
      comment:
        'vendor/shared holds Zod schemas and port interfaces only: no runtime logic, no imports ' +
        'from server code (see vendor/shared/AGENTS.md).',
      severity: 'error',
      from: { path: '^src/vendor/shared/' },
      to: { path: '^src/(modules|adapters|platform|db)/' },
    },
    {
      name: 'no-circular',
      comment:
        'A cycle means the rings are not layered. `viaOnly.pathNot` exempts cycles that pass ' +
        'THROUGH the composition root (container.ts <-> RepoIntelService) — SKILL.md §11 ' +
        'deviation 3. Two wrong spellings to avoid: `from.pathNot` only exempts a cycle’s ' +
        'STARTING module, and `via.pathNot` means "SOME module is not container.ts" (true of every ' +
        'multi-module cycle). `viaOnly.pathNot` means "NO module is container.ts", which is the one ' +
        'that works. `viaNot` is deprecated in favour of it.',
      severity: 'error',
      from: {},
      to: { circular: true, viaOnly: { pathNot: '^src/platform/container\\.ts$' } },
    },
    {
      name: 'no-orphans',
      comment:
        'An unreferenced module is usually dead code — or an unregistered one. server/INSIGHTS.md ' +
        '(2026-09-18) records an unregistered module passing every gate silently.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: ['\\.d\\.ts$', '(^|/)(eslint|drizzle|vitest)\\.config\\.[cm]?[jt]s$'],
      },
      to: {},
    },
  ],

  options: {
    // REQUIRED: this package resolves @devdigest/shared and ../reviewer-core/src through tsconfig
    // path aliases. Without this the aliases don't resolve and every rule silently under-reports.
    tsConfig: { fileName: 'tsconfig.json' },
    // Type-only imports are still coupling (e.g. `import type { Container }`).
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^(dist|coverage|clones|test|src/db/migrations)' },
  },
};
