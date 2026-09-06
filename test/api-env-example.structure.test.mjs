// Structure tests for the API environment template (apps/api/.env.example),
// produced by task 8.1.
//
// Dependency-free checks that run on Node's built-in test runner
// (`node --test`), matching the convention established in
// `root-workspace.structure.test.mjs`, `config-tsconfig.structure.test.mjs`,
// and `config-eslint.structure.test.mjs`. They assert the env template exposes
// every configuration key the API needs, with documented, non-empty,
// placeholder values — without requiring a `pnpm install`.
//
// Requirements covered: 9.2, 9.3, 9.5

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const read = (relPath) => readFileSync(join(repoRoot, relPath), "utf8");

const ENV_PATH = "apps/api/.env.example";

/**
 * Parse a simple dotenv template into an ordered list of { key, value }
 * assignments and the raw comment lines. Blank lines and `# ...` comments are
 * ignored for assignment parsing but tracked separately so we can assert the
 * file is documented. `export FOO=bar` prefixes are tolerated.
 */
function parseEnv(text) {
  const assignments = [];
  const comments = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    if (line.startsWith("#")) {
      comments.push(line);
      continue;
    }
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (match) {
      assignments.push({ key: match[1], value: match[2].trim() });
    }
  }
  return { assignments, comments };
}

const { assignments, comments } = parseEnv(read(ENV_PATH));
const byKey = new Map(assignments.map(({ key, value }) => [key, value]));

// --- Requirement 9.2: all required keys are present ---

test(".env.example declares every required API configuration key", () => {
  const required = [
    "DATABASE_URL",
    "JWT_SECRET",
    "JWT_EXPIRES_IN",
    "REFRESH_SECRET",
    "REFRESH_EXPIRES_IN",
    "PORT",
  ];
  for (const key of required) {
    assert.ok(
      byKey.has(key),
      `.env.example is missing required key: ${key}`,
    );
  }
});

test(".env.example includes the CAPTCHA_* and MAIL_* groups", () => {
  const keys = [...byKey.keys()];
  assert.ok(
    keys.some((k) => k.startsWith("CAPTCHA_")),
    "expected at least one CAPTCHA_* key",
  );
  assert.ok(
    keys.some((k) => k.startsWith("MAIL_")),
    "expected at least one MAIL_* key",
  );
});

// --- Requirement 9.3: every declared key has a non-empty placeholder value ---

test("every key in .env.example has a non-empty placeholder value", () => {
  assert.ok(assignments.length > 0, ".env.example declares no keys");
  for (const { key, value } of assignments) {
    // Strip surrounding quotes before checking for emptiness.
    const unquoted = value.replace(/^["']|["']$/g, "").trim();
    assert.ok(
      unquoted.length > 0,
      `key ${key} has an empty placeholder value`,
    );
  }
});

// --- Requirement 9.5: the file documents its variables/groups with comments ---

test(".env.example is documented with comments", () => {
  assert.ok(
    comments.length > 0,
    ".env.example must contain `# ...` comments documenting variables/groups",
  );
});

// --- Requirement 9.3 (sanity): values look like placeholders, not real secrets ---

test(".env.example values read as illustrative placeholders", () => {
  // Placeholder hostnames should point at example/localhost, not a real host.
  const dbUrl = byKey.get("DATABASE_URL") ?? "";
  assert.match(
    dbUrl,
    /(localhost|example|127\.0\.0\.1|<[^>]+>)/i,
    `DATABASE_URL should be an obvious placeholder, got: ${dbUrl}`,
  );

  // Secret-bearing keys should carry a placeholder-shaped value
  // (e.g. "replace-..."), never a value that looks like a committed secret.
  for (const key of ["JWT_SECRET", "REFRESH_SECRET", "CAPTCHA_SECRET_KEY"]) {
    const value = (byKey.get(key) ?? "").replace(/^["']|["']$/g, "");
    assert.match(
      value,
      /(replace|example|placeholder|change|your|<[^>]+>)/i,
      `${key} should read as a placeholder secret, got: ${value}`,
    );
  }
});
