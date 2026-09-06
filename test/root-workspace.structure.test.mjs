// Structure / smoke tests for the monorepo root workspace.
//
// These are dependency-free checks that run on Node's built-in test runner
// (`node --test`), so they work at the repo root without requiring a
// successful `pnpm install`. They assert the scaffolding produced by tasks
// 1.1 and 1.2 matches the locked conventions in the spec.
//
// Requirements covered: 1.1, 2.1, 2.2, 3.7, 14.1, 14.2

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const read = (relPath) => readFileSync(join(repoRoot, relPath), "utf8");
const readJson = (relPath) => JSON.parse(read(relPath));

/**
 * Extract the list items under the top-level `packages:` key of the simple
 * pnpm-workspace.yaml. The file is intentionally flat, so a lightweight parser
 * avoids adding a YAML dependency.
 */
function parseWorkspaceGlobs(yaml) {
  const lines = yaml.split(/\r?\n/);
  const globs = [];
  let inPackages = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, ""); // strip comments
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const match = line.match(/^\s*-\s*(.+?)\s*$/);
      if (match) {
        globs.push(match[1].replace(/^["']|["']$/g, ""));
      } else if (line.trim() !== "" && !/^\s/.test(line)) {
        // A new non-indented key ends the packages block.
        break;
      }
    }
  }
  return globs;
}

// --- Requirement 1.1: pnpm-workspace.yaml declares exactly apps/* and packages/* ---

test("pnpm-workspace.yaml declares exactly `apps/*` and `packages/*`", () => {
  const globs = parseWorkspaceGlobs(read("pnpm-workspace.yaml"));
  assert.deepEqual(
    [...globs].sort(),
    ["apps/*", "packages/*"],
    `expected exactly apps/* and packages/*, got: ${JSON.stringify(globs)}`,
  );
});

// --- Requirement 2.2, 3.7: root package.json fields and scripts ---

test("root package.json sets `private: true`", () => {
  const pkg = readJson("package.json");
  assert.equal(pkg.private, true);
});

test("root package.json declares engines.node = `>=22`", () => {
  const pkg = readJson("package.json");
  assert.ok(pkg.engines, "engines field is missing");
  assert.equal(pkg.engines.node, ">=22");
});

test("root package.json declares a pnpm `packageManager`", () => {
  const pkg = readJson("package.json");
  assert.ok(pkg.packageManager, "packageManager field is missing");
  assert.match(
    pkg.packageManager,
    /^pnpm@/,
    `packageManager should pin pnpm, got: ${pkg.packageManager}`,
  );
});

test("root package.json defines the four orchestrator scripts", () => {
  const pkg = readJson("package.json");
  const scripts = pkg.scripts ?? {};
  for (const name of ["lint", "typecheck", "test", "build"]) {
    assert.ok(
      typeof scripts[name] === "string" && scripts[name].length > 0,
      `missing or empty orchestrator script: ${name}`,
    );
  }
  // lint/typecheck/test fan out recursively across all workspaces;
  // build targets only the deployable apps.
  assert.match(scripts.lint, /pnpm\s+-r\b/);
  assert.match(scripts.typecheck, /pnpm\s+-r\b/);
  assert.match(scripts.test, /pnpm\s+-r\b/);
  assert.match(scripts.build, /apps\/\*/);
});

// --- Requirement 2.1: .nvmrc content is exactly `22` ---

test(".nvmrc content is exactly `22`", () => {
  assert.equal(read(".nvmrc").trim(), "22");
});

// --- Requirement 2.5 (support): .npmrc sets engine-strict=true ---
// pnpm reads the singular `engine-strict` key (the `engines-strict` spelling is
// npm-only and is ignored by pnpm, which would only warn on a Node mismatch).

test(".npmrc sets `engine-strict=true`", () => {
  const npmrc = read(".npmrc");
  assert.match(
    npmrc,
    /^\s*engine-strict\s*=\s*true\s*$/m,
    "expected engine-strict=true in .npmrc",
  );
});

// --- Requirement 14.1, 14.2: .gitignore excludes required paths, keeps .env.example ---

test(".gitignore excludes required paths and keeps `.env.example`", () => {
  const entries = read(".gitignore")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  const required = ["node_modules", "dist", ".next", "build", ".env", ".env.*"];
  for (const path of required) {
    assert.ok(
      entries.includes(path),
      `.gitignore is missing required exclusion: ${path}`,
    );
  }

  // .env.example must be preserved (negated) so it stays versioned.
  assert.ok(
    entries.includes("!.env.example"),
    ".gitignore must keep .env.example via a `!.env.example` negation",
  );
});
