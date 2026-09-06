// Structure tests for the shared ESLint config package
// (@avyo/config-eslint), produced by task 3.1.
//
// Dependency-free checks that run on Node's built-in test runner
// (`node --test`), matching the convention established in
// `root-workspace.structure.test.mjs` and `config-tsconfig.structure.test.mjs`.
//
// The package's runtime entry (`index.mjs`) imports `@eslint/js`,
// `typescript-eslint`, and `eslint-config-prettier`, none of which are
// installed without a `pnpm install`. So instead of dynamically importing the
// module, these tests assert its shape *statically* from the manifest and the
// source text: the package resolves to a single config entry and exposes
// exactly one default export (the shared flat-config array).
//
// Requirements covered: 4.1, 4.5

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const read = (relPath) => readFileSync(join(repoRoot, relPath), "utf8");
const readJson = (relPath) => JSON.parse(read(relPath));

const PKG_DIR = "packages/config-eslint";
const PKG_PATH = `${PKG_DIR}/package.json`;
const ENTRY_REL = "index.mjs";
const ENTRY_PATH = `${PKG_DIR}/${ENTRY_REL}`;

// --- Requirement 4.1 (support): package name is @avyo/config-eslint ---

test("package.json declares name `@avyo/config-eslint`", () => {
  const pkg = readJson(PKG_PATH);
  assert.equal(pkg.name, "@avyo/config-eslint");
});

// --- Requirement 4.1: exports a single resolvable config entry ---

test("package.json exposes exactly one export entry pointing at a single file", () => {
  const pkg = readJson(PKG_PATH);

  // The `.` subpath is the single public entry consumers resolve by name.
  assert.ok(pkg.exports, "package.json is missing an `exports` field");

  const entries = Object.entries(pkg.exports);
  assert.equal(
    entries.length,
    1,
    `expected exactly one export entry, got: ${JSON.stringify(pkg.exports)}`,
  );

  const [subpath, target] = entries[0];
  assert.equal(subpath, ".", `sole export subpath should be ".", got: ${subpath}`);
  assert.equal(
    target,
    `./${ENTRY_REL}`,
    `sole export should point at ./${ENTRY_REL}, got: ${JSON.stringify(target)}`,
  );

  // `main` must agree with the sole export so every resolver lands on one file.
  assert.equal(
    pkg.main,
    ENTRY_REL,
    `main should be ${ENTRY_REL}, got: ${JSON.stringify(pkg.main)}`,
  );

  // The referenced entry file must actually exist.
  assert.ok(existsSync(join(repoRoot, ENTRY_PATH)), `${ENTRY_PATH} does not exist`);
});

// --- Requirement 4.5: single shared config array via a lone default export ---

test("index.mjs exposes a single default export of a config array and no named config exports", () => {
  // Strip line and block comments so example snippets in the header docs
  // (which show `export default config;`) don't skew the export counts.
  const source = read(ENTRY_PATH)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  // Exactly one `export default` — the shared flat-config array.
  const defaultExports = source.match(/export\s+default\b/g) ?? [];
  assert.equal(
    defaultExports.length,
    1,
    `expected exactly one \`export default\`, found ${defaultExports.length}`,
  );

  // No named exports (e.g. `export const`, `export function`, `export { ... }`)
  // so consumers only ever apply the one identical rule set.
  assert.doesNotMatch(
    source,
    /export\s+(?:const|let|var|function|class|\{)/,
    "index.mjs must not declare named exports; only a single default export is allowed",
  );

  // The default export must be an array. It is defined as `const config = [...]`
  // and re-exported as `export default config`, so assert the config binding is
  // initialised to an array literal.
  assert.match(
    source,
    /const\s+config\s*=\s*\[/,
    "index.mjs should define its shared config as an array literal",
  );
  assert.match(
    source,
    /export\s+default\s+config\s*;?/,
    "index.mjs should default-export the `config` array binding",
  );
});
