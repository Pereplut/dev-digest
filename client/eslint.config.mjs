// ESLint flat config — client (@devdigest/web). Run: `pnpm lint` (not `next lint`, deprecated in 15.5).
// eslint-config-next 15.x still ships legacy configs, so they are loaded via
// FlatCompat (the create-next-app 15 shape). It requires ESLint ≤ 9.
// Rules that already fire on the existing code start as warnings.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import importPlugin from "eslint-plugin-import";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [
      ".next/**",
      ".next-*/**",
      "node_modules/**",
      "coverage/**",
      "next-env.d.ts",
      // Ported UI kit — vendored, not maintained here.
      "src/vendor/ui/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "react/no-unescaped-entities": "warn",
      "@next/next/no-img-element": "warn",
      "@next/next/no-html-link-for-pages": "warn",
      "prefer-const": "warn",
      // The vendored kit (src/vendor/ui) uses hooks in 10 modules but declares
      // no "use client", and we do not edit vendored code. src/components/
      // ui-client.ts is the single first-party client boundary over it, so the
      // kit must be imported through that and nowhere else — otherwise the
      // directive stops travelling with the components and a Server Component
      // importing the kit fails at build time.
      // The typescript-eslint variant, so `allowTypeImports` can be per path.
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@devdigest/ui",
              message:
                "Import the design system from '@/components/ui-client' instead — it is the one module that declares the client boundary for the vendored kit.",
            },
            {
              // The vendored contracts barrel uses `.js` specifiers that
              // webpack cannot resolve, so a VALUE import (a Zod schema)
              // compiles and passes vitest but breaks `next dev`/`next build`
              // with "Module not found: ./contracts/findings.js".
              name: "@devdigest/shared",
              allowTypeImports: true,
              message:
                "Only `import type` from '@devdigest/shared' in the client: a runtime import breaks the Next build (see client INSIGHTS). Mirror the constant locally.",
            },
          ],
        },
      ],
    },
  },
  {
    // The wrapper itself is the one legitimate importer of the kit.
    files: ["src/components/ui-client.ts"],
    rules: { "@typescript-eslint/no-restricted-imports": "off" },
  },
  {
    // ---- Architectural boundaries (mirrors what server/ got in Phase 2) ----
    // Until now nothing stopped one route's `_components` importing another's,
    // and nothing detected an import cycle — with 30 barrel files, cycles are
    // the classic failure mode.
    files: ["src/**/*.{ts,tsx}"],
    plugins: { import: importPlugin },
    settings: {
      "import/resolver": { typescript: { project: "./tsconfig.json" } },
    },
    rules: {
      // Dependencies flow one way: lib -> components -> app. A route segment
      // may not reach into another route segment's private `_components`.
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./src/lib",
              from: "./src/app",
              message:
                "lib/ is the bottom layer — it must not import from a route segment. Move the shared code into lib/ or components/.",
            },
            {
              target: "./src/components",
              from: "./src/app",
              message:
                "components/ is shared by every route — it must not import from one. Promote the code into components/ instead.",
            },
          ],
        },
      ],
      // Barrels make cycles easy to create and invisible to review.
      "import/no-cycle": ["error", { maxDepth: Infinity, ignoreExternal: true }],
      // A self-import is always a mistake.
      "import/no-self-import": "error",
    },
  },
];

export default config;
