// Structure tests for the web app environment example file
// (apps/web/.env.example), produced by task 11.1.
//
// Dependency-free checks that run on Node's built-in test runner
// (`node --test`), matching the convention established in
// `root-workspace.structure.test.mjs`. They assert the locked shape of the
// web `.env.example`: exactly the two public NEXT_PUBLIC_* keys with valid
// illustrative placeholder values, without requiring a `pnpm install`.
//
// Requirements covered: 11.2, 11.4

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const read = (relPath) => readFileSync(join(repoRoot, relPath), "utf8");

const ENV_PATH = "apps/web/.env.example";

/**
 * Parse `key=value` entries from a `.env`-style file, ignoring blank lines and
 * comment lines (those starting with `#`). Returns an ordered list of
 * `{ key, value, line }` records so callers can assert both content and that
 * each entry sits on its own line.
 */
function parseEnvEntries(contents) {
  const entries = [];
  const lines = contents.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      return;
    }
    const eq = line.indexOf("=");
    assert.ok(
      eq > 0,
      `line ${index + 1} is not a comment, blank, or key=value entry: ${JSON.stringify(rawLine)}`,
    );
    entries.push({
      key: line.slice(0, eq).trim(),
      value: line.slice(eq + 1).trim(),
      line: index + 1,
    });
  });
  return entries;
}

const EXPECTED_KEYS = ["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_CAPTCHA_SITE_KEY"];

// --- Requirement 11.2: exactly the two NEXT_PUBLIC_* keys, no others ---

test(".env.example contains exactly two key=value entries", () => {
  const entries = parseEnvEntries(read(ENV_PATH));
  assert.equal(
    entries.length,
    2,
    `expected exactly two env entries, got: ${JSON.stringify(entries.map((e) => e.key))}`,
  );
});

test(".env.example declares exactly NEXT_PUBLIC_API_URL and NEXT_PUBLIC_CAPTCHA_SITE_KEY", () => {
  const entries = parseEnvEntries(read(ENV_PATH));
  assert.deepEqual(
    [...entries.map((e) => e.key)].sort(),
    [...EXPECTED_KEYS].sort(),
    `unexpected env keys: ${JSON.stringify(entries.map((e) => e.key))}`,
  );
});

test("every declared key is a public NEXT_PUBLIC_* variable", () => {
  const entries = parseEnvEntries(read(ENV_PATH));
  for (const { key } of entries) {
    assert.match(
      key,
      /^NEXT_PUBLIC_/,
      `only NEXT_PUBLIC_* keys belong in the web .env.example, got: ${key}`,
    );
  }
});

test("each key sits on its own line with a non-empty placeholder value", () => {
  const entries = parseEnvEntries(read(ENV_PATH));
  const seenLines = new Set();
  for (const { key, value, line } of entries) {
    assert.ok(
      !seenLines.has(line),
      `multiple key=value entries share line ${line}`,
    );
    seenLines.add(line);
    assert.ok(
      value.length > 0,
      `${key} must have a non-empty placeholder value`,
    );
  }
});

// --- Requirement 11.4: NEXT_PUBLIC_API_URL is an absolute http/https URL ---

test("NEXT_PUBLIC_API_URL is an absolute http/https URL placeholder", () => {
  const entries = parseEnvEntries(read(ENV_PATH));
  const apiUrl = entries.find((e) => e.key === "NEXT_PUBLIC_API_URL");
  assert.ok(apiUrl, "NEXT_PUBLIC_API_URL entry is missing");

  let parsed;
  assert.doesNotThrow(() => {
    parsed = new URL(apiUrl.value);
  }, `NEXT_PUBLIC_API_URL must be an absolute URL, got: ${apiUrl.value}`);

  assert.ok(
    ["http:", "https:"].includes(parsed.protocol),
    `NEXT_PUBLIC_API_URL must use http or https, got: ${parsed.protocol}`,
  );
  assert.ok(
    parsed.host.length > 0,
    `NEXT_PUBLIC_API_URL must include a host, got: ${apiUrl.value}`,
  );
});

// --- Requirement 11.4: captcha site key is a non-empty placeholder ---

test("NEXT_PUBLIC_CAPTCHA_SITE_KEY is a non-empty placeholder value", () => {
  const entries = parseEnvEntries(read(ENV_PATH));
  const captcha = entries.find((e) => e.key === "NEXT_PUBLIC_CAPTCHA_SITE_KEY");
  assert.ok(captcha, "NEXT_PUBLIC_CAPTCHA_SITE_KEY entry is missing");
  assert.ok(
    captcha.value.length > 0,
    "NEXT_PUBLIC_CAPTCHA_SITE_KEY must have a non-empty placeholder value",
  );
});
