# Implementation Plan: Color Catalogs (color-class + official-color)

## Overview

This plan implements the two GLOBAL/official, read-only catalog modules (`color-class` and `official-color`) on the locked stack (NestJS 11, Prisma 6, PostgreSQL 17, TypeScript 5.6+, pnpm monorepo). It builds from the inside out and reuses the auth work already implemented — `JwtAuthGuard`, `EmailVerifiedGuard`, `AllExceptionsFilter`/`app.exception.ts`, `SnakeCaseInterceptor`, `@CurrentUser()`, `PrismaService`, and the `@avyo/types` contract package — rather than recreating any of it. The two module folders (`apps/api/src/modules/color-class/`, `official-color/`) already exist as stubs and are already imported in `app.module.ts`; these tasks flesh them out, not re-wire them.

Sequence: shared contract types (`@avyo/types`) → Prisma schema + migration → `color-class` module → `official-color` module → transactional idempotent seed → end-to-end and timing tests. Property tests are placed alongside the code they verify so ordering/filtering/serialization/global-read/referential-integrity/seed-convergence errors are caught early.

Each coding task references specific requirement sub-clauses and, where applicable, the design property numbers it validates. Property-based tests use `fast-check` (already a devDependency, min 100 iterations), one property per test, tagged `// Feature: color-catalogs, Property N: <property text>`, with a lightweight in-memory Prisma fake for pure logic and a test PostgreSQL for e2e. The reference implementation for structure, test-file naming (`*.property.spec.ts`, `*.e2e.spec.ts`), and conventions is the existing `auth` module.

## Tasks

- [x] 1. Add shared contract types to `@avyo/types`
  - [x] 1.1 Add `ColorClass` and `OfficialColor` response shapes
    - In `packages/types/src/index.ts`, add the `ColorClass` interface (`id`, `name`, `code`) and the `OfficialColor` interface (`id`, `class_id`, `age_group`, `code`, `title`), all snake_case wire fields, describing the on-the-wire contract asserted by both API and web.
    - Reference the existing `age_group` enum (already declared with exactly `young`/`adult`) for `OfficialColor.age_group`; do NOT redefine the enum, and do NOT redefine either shape inside the API module.
    - Export both interfaces from the package entry point and rebuild the package so `@avyo/api` resolves the new types.
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 2. Add Prisma models, enum, and migration for the catalogs
  - [x] 2.1 Add `ColorClass` and `OfficialColor` models and the native `age_group` enum
    - Edit `apps/api/prisma/schema.prisma` per the design: declare the native `enum age_group { young adult }`; add `ColorClass` (`id` UUID `gen_random_uuid()`, `name` `VarChar(255)`, `code` `VarChar(50)`, `created_at`/`updated_at` `timestamptz(6)`, `@@map("color_class")`) with a `officialColors OfficialColor[]` back-relation.
    - Add `OfficialColor` (`id` UUID, `classId` `@map("class_id")` UUID, `ageGroup age_group @map("age_group")`, `code` `VarChar(50)`, `title` `VarChar(255)`, timestamps, `@@map("official_color")`) with **no `user_id` column** on either model — this is the defining global-catalog trait.
    - Add the composite `@@unique([classId, code, ageGroup], name: "official_color_class_code_age_key")` (duplicate detection + young/adult variant support), the `@@index([classId])` (class filter), and the `colorClass` relation with `onDelete: Restrict, onUpdate: Cascade`.
    - _Requirements: 1.2, 2.1, 2.2, 3.1, 3.2, 3.5, 3.7, 7.3_
  - [x] 2.2 Enforce deterministic code-point ordering on `code` columns
    - Resolve the ordering decision from the design's "Ordering note": declare `color_class.code` and `official_color.code` with a `C` collation (`@db.VarChar(50)` plus a `COLLATE "C"` on the columns in the migration SQL) so ascending `code` sorting is Unicode-code-point stable and byte-for-byte identical across repeated requests, independent of the database locale.
    - Document in a schema comment that `age_group` orders by native enum declaration order (`young` before `adult`) and `class_id` (UUID) is compared as text under `C`.
    - _Requirements: 1.5, 2.6_
  - [x] 2.3 Generate the `add_color_catalogs` migration and regenerate the client
    - Run `prisma migrate dev --name add_color_catalogs` to create the migration under `apps/api/prisma/migrations/` (CreateEnum `age_group`, CreateTable `color_class`/`official_color`, the composite UNIQUE index, the `class_id` index, and the FK with `ON DELETE RESTRICT ON UPDATE CASCADE`) and regenerate the Prisma client.
    - Verify the generated SQL carries the `C` collation on both `code` columns from task 2.2; adjust the migration SQL if Prisma does not emit it.
    - _Requirements: 1.5, 2.1, 2.6, 3.1, 3.2, 3.5, 3.7_

- [x] 3. Checkpoint - Ensure schema compiles and migration applies
  - Ensure the Prisma client generates, the migration applies cleanly, and all existing tests pass, ask the user if questions arise.

- [x] 4. Implement the `color-class` module
  - [x] 4.1 Implement the shared `buildEnvelope` helper
    - Create a small pure helper (e.g. `apps/api/src/common/pagination/build-envelope.ts`) that wraps a row array in a single-page `Pagination_Envelope`: `data` holds exactly one entity key, `meta` reports `current_page: 1`, `last_page: 1`, `per_page: total`, `total`, and `from`/`to` null when empty; `links` carries `first`/`last`/`prev: null`/`next: null`.
    - _Requirements: 1.3, 7.5_
  - [x] 4.2 Implement `ColorClassService.list`
    - Create `apps/api/src/modules/color-class/color-class.service.ts` injecting `PrismaService`; implement `list()` as a global read with **no `user_id`/tenant filter**, `orderBy: { code: 'asc' }`, selecting `id`, `name`, `code`, and returning `buildEnvelope('color_class', rows)`.
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 7.5_
  - [x] 4.3 Write property test for color-class listing shape and completeness
    - **Property 1: Color-class listing shape and completeness**
    - **Validates: Requirements 1.1, 1.3**
  - [x] 4.4 Write property test for deterministic color-class ordering
    - **Property 3: Deterministic color-class ordering**
    - **Validates: Requirements 1.5**
  - [x] 4.5 Implement `ColorClassController` and flesh out `ColorClassModule`
    - Create `apps/api/src/modules/color-class/color-class.controller.ts` with `@Controller('color-class')`, `@UseGuards(JwtAuthGuard, EmailVerifiedGuard)` (guard order left-to-right), and a `@Get()` `@HttpCode(200)` handler delegating to `ColorClassService.list()`.
    - Flesh out the existing `color-class.module.ts` stub: register the controller and `ColorClassService`, provide `PrismaService`, and `imports: [AuthModule]` to reuse the exported guards without re-wiring the Passport strategy. Confirm it stays registered in `app.module.ts` (already imported).
    - _Requirements: 1.1, 1.4, 1.6, 5.1, 5.3, 5.4_

- [x] 5. Implement the `official-color` module
  - [x] 5.1 Implement `ListOfficialColorQueryDto`
    - Create `apps/api/src/modules/official-color/dto/list-official-color.query.dto.ts` with `@IsOptional() @IsUUID('4') class_id?: string` (non-UUID → 400 `VALIDATION_ERROR`) and `@IsOptional() @IsEnum(age_group) age_group?: age_group` (from `@avyo/types`; exact case-sensitive membership so `Young`/`ADULT`/empty/whitespace are rejected). Rely on the global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) to reject unknown query params.
    - _Requirements: 3.3, 4.2_
  - [x] 5.2 Write property test for invalid filter parameter rejection
    - **Property 11: Invalid filter parameters are rejected**
    - **Validates: Requirements 3.3, 4.2**
  - [x] 5.3 Implement `OfficialColorService.list`
    - Create `apps/api/src/modules/official-color/official-color.service.ts` injecting `PrismaService`; build an ANDed `where` from the optional `class_id`/`age_group` filters, global read with **no `user_id`/tenant filter**, `orderBy: [{ classId: 'asc' }, { ageGroup: 'asc' }, { code: 'asc' }]`, select `id`, `classId`, `ageGroup`, `code`, `title`, and return `buildEnvelope('official_color', rows)`. Empty results are a successful `200` empty list, not an error.
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 3.2, 3.4, 4.1, 4.3, 4.4, 7.5_
  - [x] 5.4 Write property test for official-color listing shape and field bounds
    - **Property 4: Official-color listing shape and field bounds**
    - **Validates: Requirements 2.1, 2.3, 2.5**
  - [x] 5.5 Write property test for deterministic official-color ordering
    - **Property 5: Deterministic official-color ordering**
    - **Validates: Requirements 2.6**
  - [x] 5.6 Write property test for `class_id` filter correctness
    - **Property 8: class_id filter correctness**
    - **Validates: Requirements 3.2, 3.4**
  - [x] 5.7 Write property test for `age_group` filter correctness
    - **Property 9: age_group filter correctness**
    - **Validates: Requirements 4.1, 4.4**
  - [x] 5.8 Write property test for combined `class_id` + `age_group` filter correctness
    - **Property 10: Combined class_id + age_group filter correctness**
    - **Validates: Requirements 4.3**
  - [x] 5.9 Implement `OfficialColorController` and flesh out `OfficialColorModule`
    - Create `apps/api/src/modules/official-color/official-color.controller.ts` with `@Controller('official-color')`, `@UseGuards(JwtAuthGuard, EmailVerifiedGuard)`, and a `@Get()` `@HttpCode(200)` handler taking `@Query() query: ListOfficialColorQueryDto` and delegating to `OfficialColorService.list(query)`.
    - Flesh out the existing `official-color.module.ts` stub: `imports: [AuthModule]`, register the controller and `OfficialColorService`, provide `PrismaService`. Confirm it stays registered in `app.module.ts`.
    - _Requirements: 2.1, 2.4, 2.7, 5.1, 5.3, 5.4_

- [x] 6. Checkpoint - Ensure module tests pass
  - Ensure both catalog modules build and all property/unit tests pass, ask the user if questions arise.

- [x] 7. Implement transactional, idempotent catalog seeding
  - [x] 7.1 Define the typed seed dataset module (shape only)
    - Create `apps/api/prisma/seed-data/color-catalog.ts` exporting `SeedColorClass` (`id` stable v4 UUID, `name`, `code`) and `SeedOfficialColor` (`id` stable v4 UUID, `classCode` resolving to a `SeedColorClass.code`, `ageGroup: 'young' | 'adult'`, `code`, `title`) plus `colorClasses` and `officialColors` typed arrays. Contents are an OPEN DECISION (real dataset TBD); ship the shape and empty/placeholder arrays so the seed logic compiles and runs unchanged once the real data lands.
    - _Requirements: 6.1, 6.4_
  - [x] 7.2 Refactor `seed.ts` to an idempotent, transactional upsert
    - Replace the no-op `apps/api/prisma/seed.ts` with logic that: validates every `officialColor.ageGroup ∈ {young, adult}` BEFORE any write (reject otherwise); opens a single `prisma.$transaction`; upserts all `color_class` records keyed by their stable authored `id`; builds an in-memory `code → id` map; resolves each official color's `classCode` to a real `class_id`; upserts all `official_color` records keyed by stable `id` with the resolved `class_id`.
    - On any unresolved `classCode`, abort and roll back the transaction leaving both tables in their pre-run state, reporting the offending official color and the unresolved reference. On any DB error, let the `$transaction` roll back and report the failed operation. Re-running converges to exactly the defined set with no duplicates and no PK changes.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
  - [x] 7.3 Write property test for young/adult variant coexistence with duplicate rejection
    - **Property 15: young/adult variant coexistence with duplicate rejection**
    - **Validates: Requirements 3.5, 3.7**
  - [x] 7.4 Write property test for seed idempotency and convergence
    - **Property 16: Seed idempotency and convergence**
    - **Validates: Requirements 6.1, 6.3, 6.4**
  - [x] 7.5 Write property test for seed reference resolution and age_group validity
    - **Property 17: Seed reference resolution and age_group validity**
    - **Validates: Requirements 6.2, 6.5**
  - [x] 7.6 Write property test for seed atomic rollback on failure
    - **Property 18: Seed atomic rollback on failure**
    - **Validates: Requirements 6.6, 6.7**
  - [x] 7.7 Write property test for official-color referential integrity
    - **Property 14: Official-color referential integrity**
    - **Validates: Requirements 3.1**

- [x] 8. Checkpoint - Ensure seed tests pass
  - Ensure the seed runs idempotently against a test database and all seed property tests pass, ask the user if questions arise.

- [x] 9. Write end-to-end integration tests for both endpoints
  - [x] 9.1 Write `color-class` e2e tests
    - Create `apps/api/src/modules/color-class/color-class.e2e.spec.ts` using `@nestjs/testing` + supertest against a test PostgreSQL: happy path (`200`, envelope shape, snake_case body), and error paths — missing/non-Bearer/invalid/expired token (`401 UNAUTHENTICATED`), unverified user (`403 EMAIL_NOT_VERIFIED`) — asserting guard order (`JwtAuthGuard` then `EmailVerifiedGuard`) and no records leaked on error.
    - **Properties 2, 6, 7, 12, 13, 19**
    - **Validates: Requirements 1.2, 1.4, 1.6, 5.1, 5.3, 5.4, 7.5, 8.1, 8.2, 8.3, 8.4**
  - [x] 9.2 Write `official-color` e2e tests
    - Create `apps/api/src/modules/official-color/official-color.e2e.spec.ts`: happy path and filter paths (`class_id`, `age_group`, combined, matching-none → `200` empty), validation errors (non-UUID `class_id`, bad `age_group`, unknown param → `400 VALIDATION_ERROR`), auth/verification gates (`401`/`403`), envelope + snake_case (`class_id`/`age_group`) assertions, referential-integrity of returned rows, and an unmapped-error `500 INTERNAL` generic-message check.
    - **Properties 2, 6, 7, 12, 13, 14, 19, 20**
    - **Validates: Requirements 2.2, 2.4, 2.7, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 5.1, 5.3, 5.4, 7.5, 8.1, 8.2, 8.5, 8.6**
  - [x] 9.3 Write two-user global-read e2e assertion
    - Add an e2e case (in either spec) that authenticates two distinct verified users and asserts both receive byte-for-byte identical `color-class` and `official-color` result sets — confirming no tenant/`user_id` filter is applied.
    - **Property 2: Global catalogs apply no tenant filter**
    - **Validates: Requirements 1.2, 2.2**
  - [x] 9.4 Write the 2000 ms response-time smoke test
    - Add a lightweight timing assertion (integration test against a seeded catalog) that `GET /color-class` returns within 2000 ms from request receipt to response dispatch. This is a performance budget, not a property-based iteration.
    - _Requirements: 1.7_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure the full suite (property, unit, e2e, timing) passes and both modules build, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP, though the property tests are strongly recommended for the ordering, filtering, global-read, and seed-convergence guarantees.
- Each task references specific requirement sub-clauses for traceability; property-test tasks additionally cite the design property number and its validated requirements.
- Property-based tests use `fast-check` (already a devDependency) at a minimum of 100 iterations (`numRuns: 100`), one property per test, tagged `// Feature: color-catalogs, Property N: <property text>`, with an in-memory Prisma fake for pure logic and a test PostgreSQL for e2e.
- Reuse — do NOT recreate — the existing auth infrastructure: `JwtAuthGuard`, `EmailVerifiedGuard`, `AllExceptionsFilter`/`app.exception.ts`, `SnakeCaseInterceptor`, `@CurrentUser()`, `PrismaService`, and the `@avyo/types` contract. Both catalog modules `imports: [AuthModule]` to reuse the exported guards.
- Catalog source data (Req 6, Open Decision) is not yet fixed; the seed consumes a separate typed dataset module and contains no hardcoded color data, so supplying the real dataset requires no seed-logic change.
- All 20 correctness properties from the design are covered: 1 & 3 (color-class service), 4/5/8/9/10 (official-color service), 11 (query DTO), 14–18 (seed + referential integrity), and 2/6/7/12/13/19/20 (e2e boundary). Cross-cutting properties (snake_case, error envelope) are re-asserted at the catalog boundary via e2e rather than re-testing the shared components in isolation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3"] },
    { "id": 3, "tasks": ["4.1", "5.1", "7.1"] },
    { "id": 4, "tasks": ["4.2", "5.3", "5.2", "7.2"] },
    { "id": 5, "tasks": ["4.3", "4.4", "5.4", "5.5", "5.6", "5.7", "5.8", "7.3", "7.4", "7.5", "7.6", "7.7"] },
    { "id": 6, "tasks": ["4.5", "5.9"] },
    { "id": 7, "tasks": ["9.1", "9.2", "9.3", "9.4"] }
  ]
}
```
