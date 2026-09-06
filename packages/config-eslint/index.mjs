// @avyo/config-eslint
// Shared ESLint 9 flat-config array for every Avyo workspace.
//
// Consumers re-export this array verbatim from their own eslint.config.mjs:
//
//   import config from "@avyo/config-eslint";
//   export default config;
//
// Built from @eslint/js (core recommended rules), typescript-eslint
// (recommended TypeScript rules), and eslint-config-prettier (disables any
// stylistic rules that would conflict with Prettier formatting).

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

/**
 * Single shared flat-config array. This is the only entry point exported by
 * the package (Req 4.1); consumers apply it without adding rules of their own
 * so every workspace enforces an identical rule set (Req 4.5).
 *
 * @type {import("eslint").Linter.Config[]}
 */
const config = [
  // Global ignores shared by all workspaces. Build output, dependencies, and
  // framework-generated declaration files (e.g. Next.js `next-env.d.ts`) are
  // not authored source and must not be linted.
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/next-env.d.ts",
    ],
  },

  // ESLint core recommended rules.
  js.configs.recommended,

  // typescript-eslint recommended rules (flat-config presets).
  ...tseslint.configs.recommended,

  // Shared rule tuning applied uniformly to every workspace. Honor the
  // conventional leading-underscore marker for intentionally-unused bindings
  // (unused args, caught errors, and vars omitted via rest destructuring).
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  // Turn off any rules that conflict with Prettier. Must come last so it wins.
  prettier,
];

export default config;
