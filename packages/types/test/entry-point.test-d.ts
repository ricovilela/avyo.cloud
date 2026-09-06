// Compile-time (type-level) example test for the @avyo/types entry point.
//
// This file is never emitted — it is type-checked by `tsc --noEmit`
// (see `tsconfig.test.json`) to prove that a *consumer* can import the
// whole contract from the package root `@avyo/types` with no deep or
// subpath imports, and that each export has the designed shape.
//
// Validates: Requirements 6.1, 6.2, 6.7

import {
  sex,
  age_group,
  type Pagination_Envelope,
  type Error_Envelope,
} from "@avyo/types";

// --- Requirement 6.7: package-root import resolves all four exports ---------
// The four symbols above are imported from the package root only. If any
// required a subpath import (e.g. "@avyo/types/dist/index"), this file would
// fail to type-check.

// --- Requirement 6.1 / 6.2: enums are usable as both values and types -------
const _sexValue: sex = sex.M;
const _sexF: sex = sex.F;
const _ageYoung: age_group = age_group.young;
const _ageAdult: age_group = age_group.adult;

// --- Requirement 6.3 / 6.4: Pagination_Envelope<T> shape --------------------
const _page: Pagination_Envelope<{ bird: number[] }> = {
  data: { bird: [1, 2, 3] },
  links: { first: "https://api/first", last: "https://api/last", prev: null, next: null },
  meta: {
    current_page: 1,
    from: null,
    last_page: 1,
    per_page: 20,
    to: null,
    total: 0,
  },
};

// --- Requirement 6.5: Error_Envelope shape (details optional) ---------------
const _err: Error_Envelope = {
  error: { code: "VALIDATION", message: "invalid payload" },
};

// Reference the bindings so the type-only checks are retained without
// tripping lint's no-unused rules.
void _sexValue;
void _sexF;
void _ageYoung;
void _ageAdult;
void _page;
void _err;
