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
    },
  },
];

export default config;
