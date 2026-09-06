// Structure tests for the web app skeleton (apps/web), produced by task 10.
//
// Dependency-free checks that run on Node's built-in test runner
// (`node --test`), matching the convention established in
// `root-workspace.structure.test.mjs`. They assert the locked shape of the
// Next.js 15 App Router skeleton — App Router entry files, the shadcn/ui
// components folder, the centralized lib (api-client + query-provider), and
// the hooks folder — plus that the api-client reads its base URL from
// `NEXT_PUBLIC_API_URL`, all without requiring a `pnpm install`.
//
// Requirements covered: 10.1, 10.2, 10.3, 10.4

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const path = (relPath) => join(repoRoot, relPath);
const read = (relPath) => readFileSync(path(relPath), "utf8");

function assertFileExists(relPath) {
  assert.ok(
    existsSync(path(relPath)) && statSync(path(relPath)).isFile(),
    `expected file to exist: ${relPath}`,
  );
}

function assertDirExists(relPath) {
  assert.ok(
    existsSync(path(relPath)) && statSync(path(relPath)).isDirectory(),
    `expected directory to exist: ${relPath}`,
  );
}

// --- Requirement 10.1 / 10.4: App Router has a root layout and page ---

test("app/ has a root layout.tsx", () => {
  assertFileExists("apps/web/src/app/layout.tsx");
});

test("app/ has a root page.tsx", () => {
  assertFileExists("apps/web/src/app/page.tsx");
});

// --- Requirement 10.2: shadcn/ui components folder exists ---

test("components/ui/ directory exists", () => {
  assertDirExists("apps/web/src/components/ui");
});

// --- Requirement 10.3: centralized lib has api-client + query-provider ---

test("lib/ has api-client.ts", () => {
  assertFileExists("apps/web/src/lib/api-client.ts");
});

test("lib/ has query-provider.tsx", () => {
  assertFileExists("apps/web/src/lib/query-provider.tsx");
});

// --- Requirement 10.4: hooks folder exists ---

test("hooks/ directory exists", () => {
  assertDirExists("apps/web/src/hooks");
});

// --- Requirement 10.3: api-client reads NEXT_PUBLIC_API_URL ---

test("api-client.ts references NEXT_PUBLIC_API_URL", () => {
  const contents = read("apps/web/src/lib/api-client.ts");
  assert.match(
    contents,
    /NEXT_PUBLIC_API_URL/,
    "api-client.ts must resolve its base URL from NEXT_PUBLIC_API_URL",
  );
});
