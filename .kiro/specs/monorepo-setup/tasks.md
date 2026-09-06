# Implementation Plan: Monorepo Setup

## Overview

This plan scaffolds the Avyo pnpm-workspace monorepo in incremental, code-focused steps:
root workspace → shared config packages (`config-tsconfig`, `config-eslint`) → shared contract
(`@avyo/types`) → API skeleton (NestJS 11 + Prisma 6) → web skeleton (Next.js 15) → CI → Railway
deploy docs → final end-to-end verification. Each step builds on the previous one and ends by
wiring the new workspace into the root orchestrators so nothing is left orphaned.

Per the design's Testing Strategy, this spec is infrastructure/scaffolding only: there are **no
property-based tests**. Testing is limited to structure/smoke checks, build/integration checks,
and example/edge-case unit tests (notably API env validation and the `@avyo/types` entry point).
All test-related sub-tasks are marked optional with `*`.

Implementation language: **TypeScript** (locked by `tech.md`; the design uses concrete TypeScript,
not pseudocode).

## Tasks

- [x] 1. Scaffold repository root workspace and version locking
  - [x] 1.1 Create pnpm workspace and root package manifest
    - Create `pnpm-workspace.yaml` declaring exactly two globs: `apps/*` and `packages/*` (no others)
    - Create root `package.json` with `private: true`, `packageManager` pinning pnpm, `engines.node` = `>=22`
    - Add orchestrator scripts: `lint` = `pnpm -r lint`, `typecheck` = `pnpm -r typecheck`, `test` = `pnpm -r test`, `build` = `pnpm -r --filter "./apps/*" build`
    - Add shared devDependencies: TypeScript (`>=5.6 <6`), ESLint, Prettier
    - _Requirements: 1.1, 1.2, 2.2, 2.4, 3.1, 3.2, 3.3, 3.4, 3.6, 3.7_

  - [x] 1.2 Create runtime-lock and hygiene files
    - Create `.nvmrc` with content exactly `22`
    - Create `.npmrc` with `engine-strict=true` (pnpm's singular key; `engines-strict` is npm-only and ignored by pnpm) so pnpm aborts install on a Node version mismatch
    - Update root `.gitignore` to exclude `.env` and `.env.*` (keep `.env.example`), `node_modules`, `dist`, `.next`, `build`
    - _Requirements: 2.1, 2.5, 14.1, 14.2, 14.4_

  - [x] 1.3 Write structure/smoke tests for root workspace
    - Assert `pnpm-workspace.yaml` declares exactly `apps/*` and `packages/*`
    - Assert root `package.json` has `private: true`, `engines.node` = `>=22`, `packageManager`, and the four orchestrator scripts
    - Assert `.nvmrc` content is exactly `22`, `.npmrc` sets `engine-strict=true`, and `.gitignore` excludes required paths while keeping `.env.example`
    - _Requirements: 1.1, 2.1, 2.2, 3.7, 14.1, 14.2_

- [x] 2. Create shared base TypeScript config package (@avyo/config-tsconfig)
  - [x] 2.1 Scaffold packages/config-tsconfig
    - Create `packages/config-tsconfig/package.json` with `name` = `@avyo/config-tsconfig`
    - Create `base.json` with `strict: true`, modern `target`/`lib`, appropriate `moduleResolution`, `declaration: true`, `esModuleInterop`, `skipLibCheck` (TS 5.6+)
    - Add a `lint` and `typecheck` script so the root orchestrators can invoke this workspace uniformly
    - _Requirements: 1.7, 2.3, 5.1_

  - [x] 2.2 Write structure test for base tsconfig
    - Assert `base.json` sets `strict: true` and the expected compiler options
    - Assert package `name` is `@avyo/config-tsconfig`
    - _Requirements: 5.1_

- [x] 3. Create shared ESLint config package (@avyo/config-eslint)
  - [x] 3.1 Scaffold packages/config-eslint
    - Create `packages/config-eslint/package.json` with `name` = `@avyo/config-eslint`, exporting a single flat-config entry
    - Implement the shared ESLint 9 flat-config array from `@eslint/js`, `typescript-eslint`, and Prettier compatibility
    - Extend the base tsconfig from `@avyo/config-tsconfig` for this package's own type-checking; add `lint`/`typecheck` scripts
    - _Requirements: 1.7, 4.1, 5.2, 5.6_

  - [x] 3.2 Write structure test for shared ESLint config
    - Assert the package exports a single resolvable config array and declares `name` = `@avyo/config-eslint`
    - _Requirements: 4.1, 4.5_

- [x] 4. Create shared contract package (@avyo/types)
  - [x] 4.1 Scaffold packages/types manifest and tooling
    - Create `packages/types/package.json` with `name` = `@avyo/types`, `main`/`types`/`exports` pointing at the single compiled entry (`dist/index.js` + `dist/index.d.ts`)
    - Add `build` (`tsc`), `typecheck`, `lint`, and `test` scripts
    - Create `tsconfig.json` extending `@avyo/config-tsconfig/base.json`
    - Create `eslint.config.mjs` re-exporting `@avyo/config-eslint`
    - _Requirements: 1.5, 1.7, 4.4, 5.4, 5.6_

  - [x] 4.2 Implement contract types and enums
    - Create `src/index.ts` as the single entry point exporting the whole contract
    - Export `sex` enum (exactly `M`, `F`) and `age_group` enum (exactly `young`, `adult`) as real runtime values
    - Export `Pagination_Envelope<T>` with `data`, `links` (`first`, `last`, nullable `prev`/`next`), `meta` (`current_page`, `from` nullable, `last_page`, `per_page`, `to` nullable, `total`); count fields as non-negative integers
    - Export `Error_Envelope` with `error.code` (string), `error.message` (string), optional `details[]` of `field`/`message` entries
    - Name all contract fields in snake_case
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 4.3 Write example/type-level tests for @avyo/types entry point
    - Compile-time example: import `sex`, `age_group`, `Pagination_Envelope`, `Error_Envelope` from the package root (no subpath imports) and type-check
    - Assert `sex` has exactly members `M`/`F` and `age_group` exactly `young`/`adult`
    - _Requirements: 6.1, 6.2, 6.7_

- [x] 5. Checkpoint - shared packages build and pass checks
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Scaffold API application skeleton (@avyo/api)
  - [x] 6.1 Create API manifest, tsconfig, eslint, and nest-cli
    - Create `apps/api/package.json` with `name` = `@avyo/api`, NestJS deps pinned `>=11 <12`, Prisma CLI + Client pinned `>=6 <7`, `@avyo/types` via `workspace:` protocol, and `build`/`typecheck`/`lint`/`test` scripts
    - Create `apps/api/tsconfig.json` extending `@avyo/config-tsconfig/base.json` (override `emitDecoratorMetadata`/`experimentalDecorators`)
    - Create `apps/api/eslint.config.mjs` re-exporting `@avyo/config-eslint`
    - Create `nest-cli.json`
    - _Requirements: 1.3, 1.6, 4.2, 5.2, 5.6, 7.8, 8.5_

  - [x] 6.2 Implement config module with env validation
    - Create `src/config/` with a validation function over `process.env` for required vars (`DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_SECRET`, `REFRESH_EXPIRES_IN`, `PORT`)
    - On missing/invalid variables, throw before startup naming every offending variable; return typed parsed config on success
    - _Requirements: 7.4, 7.5_

  - [x] 6.3 Write unit tests for env validation
    - All required vars present → returns typed config
    - One missing → throws naming that variable; invalid type (non-numeric `PORT`) → throws naming that variable
    - _Requirements: 7.4, 7.5_

  - [x] 6.4 Create common directory structure
    - Create `src/common/` with exactly five subdirectories: `guards/`, `interceptors/`, `filters/`, `decorators/`, `prisma/`, each with a placeholder (`.gitkeep`/index)
    - _Requirements: 7.3_

  - [x] 6.5 Create the 13 placeholder MVP modules
    - Create `src/modules/` with one folder per MVP module (`auth`, `bird`, `genetics`, `calendar`, `band`, `band-color`, `cage`, `species`, `official-color`, `color-class`, `status`, `management`, `aviary`)
    - Each folder contains at minimum a `*.module.ts` decorated with `@Module({})`
    - _Requirements: 7.6_

  - [x] 6.6 Implement root module and bootstrap entry point
    - Create `src/app.module.ts` importing the config module and registering all 13 MVP modules
    - Create `src/main.ts` that bootstraps Nest and listens on `PORT` from validated config
    - _Requirements: 7.1, 7.2, 7.6_

  - [x] 6.7 Write boot/structure smoke tests for the API
    - Assert `src/common/` has exactly the five subdirectories and `src/modules/` has exactly the 13 module folders each with a `*.module.ts` imported by `AppModule`
    - Assert `main.ts` binds to the validated `PORT` value (example with a fixed port)
    - _Requirements: 7.1, 7.3, 7.6_

- [x] 7. Set up Prisma 6 in the API
  - [x] 7.1 Create Prisma schema and migrations directory
    - Create `prisma/schema.prisma` with `datasource db { provider = "postgresql"; url = env("DATABASE_URL") }` and `generator client { provider = "prisma-client-js" }`
    - Create the `prisma/migrations/` directory (versioned, empty)
    - _Requirements: 8.1, 8.2, 8.6_

  - [x] 7.2 Create placeholder seed script and register it
    - Create `prisma/seed.ts` as a no-op that runs to completion, exits 0, and writes no records
    - Register it as the Prisma seed command in `apps/api/package.json` (`"prisma": { "seed": "ts-node prisma/seed.ts" }`)
    - _Requirements: 8.3, 8.4_

  - [x] 7.3 Verify prisma generate produces the client
    - Run `prisma generate` and assert the client is produced with no schema validation errors
    - _Requirements: 8.7_

- [x] 8. Create API environment example file
  - [x] 8.1 Write apps/api/.env.example
    - Include keys `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_SECRET`, `REFRESH_EXPIRES_IN`, `PORT`, at least one `CAPTCHA_*`, and at least one `MAIL_*`
    - Assign every key a non-empty illustrative placeholder (no real secrets/credentials) and a descriptive comment per variable or group
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 8.2 Write structure test for API .env.example
    - Assert all required keys/groups are present with non-empty non-secret placeholders and comments
    - _Requirements: 9.2, 9.3, 9.5_

- [x] 9. Checkpoint - API builds, boots validation, and generates Prisma client
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Scaffold web application skeleton (@avyo/web)
  - [x] 10.1 Create web manifest, tsconfig, eslint, and Next config
    - Create `apps/web/package.json` with `name` = `@avyo/web`, deps pinned: Next `15.x`, React/React DOM `19.x`, TanStack Query `5.x`, shadcn/ui; `@avyo/types` via `workspace:` protocol; `build`/`typecheck`/`lint`/`test` scripts
    - Create `apps/web/tsconfig.json` extending `@avyo/config-tsconfig/base.json` (override `jsx`)
    - Create `apps/web/eslint.config.mjs` re-exporting `@avyo/config-eslint`
    - Create `next.config.ts`
    - _Requirements: 1.4, 1.6, 4.3, 5.3, 5.6, 10.6_

  - [x] 10.2 Set up Tailwind v4 and shadcn/ui
    - Wire Tailwind v4 via `@import "tailwindcss"` in `globals.css` plus the PostCSS plugin so utility classes are processed in App Router output
    - Create `components.json` for shadcn/ui and the `src/components/ui/` target directory
    - Create the `src/hooks/` directory for shared hooks
    - _Requirements: 10.2, 10.4, 10.5_

  - [x] 10.3 Implement lib modules (API client + query provider)
    - Create `src/lib/api-client.ts` reading base URL from `NEXT_PUBLIC_API_URL`
    - Create `src/lib/query-provider.tsx` instantiating a `QueryClient` and returning a `QueryClientProvider` client component wrapping `children`
    - _Requirements: 10.3_

  - [x] 10.4 Implement App Router root layout and page
    - Create `src/app/layout.tsx` as the root layout wrapping the tree in the TanStack Query provider
    - Create `src/app/page.tsx` as a minimal root page
    - _Requirements: 10.1, 10.3_

  - [x] 10.5 Write structure smoke test for web skeleton
    - Assert `src/app/` has layout + page, `src/components/ui/`, `src/lib/` (api-client + query-provider), and `src/hooks/` exist
    - Assert `api-client.ts` references `NEXT_PUBLIC_API_URL`
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 11. Create web environment example file
  - [x] 11.1 Write apps/web/.env.example
    - List exactly `NEXT_PUBLIC_API_URL` (example absolute http/https URL) and `NEXT_PUBLIC_CAPTCHA_SITE_KEY`, each as `key=placeholder`
    - Use non-real illustrative values
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 11.2 Write structure test for web .env.example
    - Assert exactly the two `NEXT_PUBLIC_*` keys with valid placeholder shapes
    - _Requirements: 11.2, 11.4_

- [x] 12. Checkpoint - web app builds on Node 22
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Create CI pipeline
  - [x] 13.1 Write .github/workflows/ci.yml
    - Trigger on `pull_request` targeting `main`
    - Steps: checkout → setup Node 22 (matching `.nvmrc`) → setup pnpm with dependency cache → `pnpm install --frozen-lockfile`
    - Run `lint`, `typecheck`, `test`, `build` for affected workspaces using `pnpm --filter "...[origin/main]"` (changed + dependents), skipping unaffected
    - Ensure any non-zero stage fails the check and all-green reports passing
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

- [x] 14. Author Railway deploy and repository-hygiene documentation
  - [x] 14.1 Write docs/deploy.md (or README deploy section)
    - Document the three services table: `api` (root `apps/api`, build `pnpm --filter @avyo/api build`, `api.avyo.cloud`), `web` (root `apps/web`, build `pnpm --filter @avyo/web build`, `app.avyo.cloud`), `postgres` (managed plugin, private network only, no public domain)
    - Document path-based redeploy of only affected services on push to `main`
    - Document `prisma migrate deploy` on `api` deploy before serving, aborting and keeping the previous version on failure with the error surfaced in deploy logs
    - Document that `DATABASE_URL` and all secrets are Railway service env vars (never committed), only `.env.example` is versioned
    - Document `main` is protected, no direct pushes, PR-only integration, and untracking guidance for any already-tracked secret file
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 14.3, 14.5_

- [x] 15. Final verification and wiring
  - [x] 15.1 Verify end-to-end foundation on Node 22
    - Run `pnpm install` on Node 22 (confirm it aborts on Node <22 via `engines-strict`)
    - Run `pnpm -r typecheck` and `pnpm -r lint` across all workspaces (proves shared tsconfig/eslint inheritance resolves)
    - Run `pnpm --filter @avyo/api build` and `pnpm --filter @avyo/web build`; confirm zero exit and build output
    - Run `prisma generate` and `prisma db seed` (placeholder) — client produced, seed exits 0 writing nothing
    - Run structure/smoke assertions confirming the five config members resolve, `src/common/` five subdirs, `src/modules/` 13 folders, and `.env.example` shapes
    - _Requirements: 2.5, 3.1, 3.2, 3.4, 3.5, 7.7, 8.3, 8.7, 10.7, 10.8_

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP scaffold.
- This spec is infrastructure/scaffolding only — there are **no property-based tests** (see design Testing Strategy). Testing uses structure/smoke checks, build/integration checks, and example/edge-case unit tests (API env validation, `@avyo/types` entry point).
- Each task references specific requirement sub-clauses for traceability.
- Checkpoints ensure incremental validation as each layer (shared packages → API → web) is completed.
- Dependency direction is one-way: config packages and `@avyo/types` are consumed by the apps; nothing in `packages/*` depends on `apps/*`.
- This workflow produces planning and scaffolding artifacts only; it does not implement domain behavior.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1"] },
    { "id": 3, "tasks": ["3.2", "4.1"] },
    { "id": 4, "tasks": ["4.2"] },
    { "id": 5, "tasks": ["4.3", "6.1", "10.1"] },
    { "id": 6, "tasks": ["6.2", "6.4", "6.5", "7.1", "8.1", "10.2", "10.3", "11.1"] },
    { "id": 7, "tasks": ["6.3", "6.6", "7.2", "8.2", "10.4", "11.2", "13.1", "14.1"] },
    { "id": 8, "tasks": ["6.7", "7.3", "10.5"] },
    { "id": 9, "tasks": ["15.1"] }
  ]
}
```
