// ESLint flat config — reviewer-core (@devdigest/reviewer-core). Run: `npm run lint`.
// Not type-aware (fast, no tsconfig project). Rules that already fire on the
// existing code start as warnings; tighten them one at a time.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "no-empty": "warn",
      "prefer-const": "warn",
    },
  },
);
