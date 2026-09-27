// ESLint flat config — mcp (@devdigest/mcp). Run: `npm run lint` (includes `npm run arch`).
// Not type-aware (fast, no tsconfig project). These are the fast, in-editor half
// of the ring checks from `.claude/skills/onion-architecture/SKILL.md`, applied
// to this package's rings (see AGENTS.md's ring table); the full import-graph
// rules live in `.dependency-cruiser.cjs` (`npm run arch`).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

const MCP_SDK_GROUP = ["@modelcontextprotocol/*", "@modelcontextprotocol/**"];

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
  // ---- Ring 4 only: the MCP SDK ----
  // registry.ts (tool registration) and entry/* (composition roots / transports)
  // are the only files allowed to import the MCP SDK. Everything else — rings
  // 1-3 plus the http adapter and mocks — must return plain data.
  {
    files: ["src/**/*.ts"],
    ignores: ["src/registry.ts", "src/entry/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: MCP_SDK_GROUP,
              message:
                "The MCP SDK is imported only from registry.ts and entry/* (onion-architecture: ring 4 only).",
            },
          ],
        },
      ],
    },
  },
  // ---- Rings 1-2-3: no Zod, no fetch ----
  // core/**, ports.ts and tools/** return plain TypeScript data; Zod 4 and
  // `fetch` live only in ring 4 (registry.ts validates input, adapters/http
  // calls the API).
  {
    files: ["src/core/**/*.ts", "src/ports.ts", "src/tools/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["zod", "zod/*"],
              message: "Rings 1-3 use plain TypeScript types; Zod lives only in registry.ts (ring 4).",
            },
          ],
        },
      ],
    },
  },
  // ---- fetch confined to the HTTP adapter ----
  // Every file except adapters/http/** is denied the `fetch` global: rings 1-3
  // never call the network, and registry.ts/entry/*/mocks.ts/container.ts talk
  // to the API only through the DevDigestApi port.
  {
    files: ["src/**/*.ts"],
    ignores: ["src/adapters/http/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "fetch is only called from adapters/http/ — everything else takes the DevDigestApi port." },
      ],
    },
  },
);
