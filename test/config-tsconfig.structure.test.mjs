// Structure tests for the shared base TypeScript config package
// (@avyo/config-tsconfig), produced by task 2.1.
//
// Dependency-free checks that run on Node's built-in test runner
// (`node --test`), matching the convention established in
// `root-workspace.structure.test.mjs`. They assert the locked base
// tsconfig shape from the spec without requiring a `pnpm install`.
//
// Requirements covered: 5.1

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const read = (relPath) => readFileSync(join(repoRoot, relPath), "utf8");
const readJson = (relPath) => JSON.parse(read(relPath));

const BASE_PATH = "packages/config-tsconfig/base.json";
const PKG_PATH = "packages/config-tsconfig/package.json";

// --- Requirement 5.1: base config enables strict type-checking + expected options ---

test("base.json enables `strict: true`", () => {
  const base = readJson(BASE_PATH);
  assert.ok(base.compilerOptions, "compilerOptions block is missing");
  assert.equal(
    base.compilerOptions.strict,
    true,
    "base tsconfig must enable strict type-checking",
  );
});

test("base.json declares the expected compiler options (TS 5.6+)", () => {
  const { compilerOptions } = readJson(BASE_PATH);

  // Exact-value options locked by the spec.
  const expected = {
    target: "ES2023",
    module: "ESNext",
    moduleResolution: "bundler",
    strict: true,
    declaration: true,
    declarationMap: true,
    sourceMap: true,
    esModuleInterop: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    resolveJsonModule: true,
    isolatedModules: true,
    noUncheckedIndexedAccess: true,
    noImplicitOverride: true,
  };

  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(
      compilerOptions[key],
      value,
      `base tsconfig compilerOptions.${key} should be ${JSON.stringify(value)}, got: ${JSON.stringify(compilerOptions[key])}`,
    );
  }

  // `lib` is an array; assert it targets the modern ES2023 lib.
  assert.deepEqual(
    compilerOptions.lib,
    ["ES2023"],
    `base tsconfig compilerOptions.lib should be ["ES2023"], got: ${JSON.stringify(compilerOptions.lib)}`,
  );
});

// --- Requirement 5.1 (support): package name is @avyo/config-tsconfig ---

test("package.json declares name `@avyo/config-tsconfig`", () => {
  const pkg = readJson(PKG_PATH);
  assert.equal(pkg.name, "@avyo/config-tsconfig");
});
