/**
 * Architecture rules for @devdigest/mcp — the onion rings from AGENTS.md's ring
 * table (mirrors `.claude/skills/onion-architecture/SKILL.md`, applied to this
 * package). Run: `npm run arch` (folded into `npm run lint`).
 *
 * Paths are RESOLVED REGEX, not globs, relative to this package root.
 *
 * The `fetch`-confined-to-adapters/http rule is NOT here: dependency-cruiser
 * only sees imports, and `fetch` is a global, not an import — that rule is the
 * ESLint `no-restricted-globals` zone in eslint.config.mjs instead.
 */
module.exports = {
  forbidden: [
    {
      name: 'mcp-sdk-only-in-registry-and-entry',
      comment:
        'The MCP SDK (@modelcontextprotocol/*) is imported only from registry.ts (tool registration) ' +
        'and entry/* (stdio/http composition roots). Rings 1-3 return plain data; wrapping into ' +
        '{ content, isError } happens in exactly one place — the "a service never imports a vendor ' +
        'SDK" rule (AGENTS.md ring table).',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/(registry\\.ts|entry/)' },
      to: { path: '^node_modules/@modelcontextprotocol' },
    },
    {
      name: 'no-zod-in-rings-1-3',
      comment:
        'core/**, ports.ts and tools/** are plain TypeScript (rings 1-3): no Zod. Zod 4 input ' +
        'schemas are built only in registry.ts (ring 4) — this is the whole reason mcp/ is a ' +
        'separate package from server/reviewer-core (Zod 3 vs Zod 4 never meet).',
      severity: 'error',
      from: { path: '^src/(core/|ports\\.ts$|tools/)' },
      to: { path: '^node_modules/zod' },
    },
    {
      name: 'core-stays-pure',
      comment:
        'core/project.ts and core/errors.ts (ring 1) are pure free functions: no MCP SDK, no Zod, ' +
        'no fetch (fetch is checked by ESLint, not here), no port implementation.',
      severity: 'error',
      from: { path: '^src/core/' },
      to: { path: '^(node_modules/(@modelcontextprotocol|zod)|src/(adapters|registry\\.ts|container\\.ts|entry))' },
    },
    {
      name: 'port-imports-nothing-inward',
      comment:
        'ports.ts (ring 2) declares DevDigestApi and plain TS types only — it must not import any ' +
        'implementation (adapters, tools, registry, container, entry). SKILL.md ring table: ' +
        '"port: must not import any implementation".',
      severity: 'error',
      from: { path: '^src/ports\\.ts$' },
      to: { path: '^src/(adapters|tools|registry\\.ts|container\\.ts|entry)' },
    },
    {
      name: 'tools-no-vendor-sdk',
      comment:
        'tools/run-review.ts and tools/findings.ts (ring 3) orchestrate through the DevDigestApi ' +
        'port only — no MCP SDK (checked above), no fetch (ESLint), no adapters or registry.',
      severity: 'error',
      from: { path: '^src/tools/' },
      to: { path: '^src/(adapters|registry\\.ts|entry)' },
    },
    {
      name: 'no-circular',
      comment: 'A cycle means the rings are not layered.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment: 'An unreferenced module is usually dead code — or an unregistered one.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: ['\\.d\\.ts$', '(^|/)(eslint|vitest)\\.config\\.[cm]?[jt]s$'],
      },
      to: {},
    },
  ],

  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    // Type-only imports are still coupling (e.g. `import type { DevDigestApi }`).
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^(dist|coverage|test)' },
  },
};
