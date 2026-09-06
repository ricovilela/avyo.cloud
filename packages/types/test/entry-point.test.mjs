// Runtime example test for the @avyo/types entry point.
//
// Runs on Node's built-in test runner (`node --test`) and imports from the
// package root `@avyo/types` (self-reference via the package `exports` map),
// proving both that the root entry point resolves at runtime with no subpath
// import (Req 6.7) and that the enums have exactly their designed members.
//
// Requires the package to be built first (`pnpm build` → dist/), which the
// package `test` script guarantees.
//
// Validates: Requirements 6.1, 6.2, 6.7

import { test } from "node:test";
import assert from "node:assert/strict";

import { sex, age_group } from "@avyo/types";

// --- Requirement 6.1: `sex` has exactly members M/F ------------------------

test("`sex` enum has exactly members M and F", () => {
  assert.deepEqual(Object.keys(sex), ["M", "F"]);
  assert.deepEqual(Object.values(sex), ["M", "F"]);
  assert.equal(sex.M, "M");
  assert.equal(sex.F, "F");
});

// --- Requirement 6.2: `age_group` has exactly members young/adult ----------

test("`age_group` enum has exactly members young and adult", () => {
  assert.deepEqual(Object.keys(age_group), ["young", "adult"]);
  assert.deepEqual(Object.values(age_group), ["young", "adult"]);
  assert.equal(age_group.young, "young");
  assert.equal(age_group.adult, "adult");
});
