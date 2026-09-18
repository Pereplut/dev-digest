// ESLint flat config — client (@devdigest/web). Run: `pnpm lint` (not `next lint`, deprecated in 15.5).
// eslint-config-next 15.x still ships legacy configs, so they are loaded via
// FlatCompat (the create-next-app 15 shape). It requires ESLint ≤ 9.
// Rules that already fire on the existing code start as warnings.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

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
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@devdigest/ui",
              message:
                "Import the design system from '@/components/ui-client' instead — it is the one module that declares the client boundary for the vendored kit.",
            },
          ],
        },
      ],
    },
  },
  {
    // The wrapper itself is the one legitimate importer of the kit.
    files: ["src/components/ui-client.ts"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default config;
