# Requirements Document

## Introduction

This spec covers the **infrastructure and scaffolding foundation** of the Avyo project — a bird breeding management system. It is the FIRST spec of the project and establishes the monorepo, workspaces, shared packages, application skeletons, CI, and deploy configuration so that subsequent feature specs (auth, bird, genetics, etc.) can build on top of a stable, convention-locked foundation.

The authoritative references are `mvp-project.md` (sections 2.1, 6, 10, 11.4) and the workspace steering files (`tech.md`, `structure.md`, `devops.md`). All versions, names, and conventions defined there are locked and MUST be honored.

**In scope:** single GitHub monorepo managed with pnpm workspaces; directory layout (`apps/api`, `apps/web`, `packages/types`, `packages/config-eslint`, `packages/config-tsconfig`); Node 22 / TypeScript 5.6+ locking; shared eslint and tsconfig packages; the shared contract skeleton in `@avyo/types` (enums, pagination envelope, error envelope); NestJS 11 API skeleton with Prisma 6 setup; Next.js 15 web skeleton with Tailwind v4, shadcn/ui, and TanStack Query; CI pipeline; and Railway deploy configuration.

**Out of scope:** any business logic or endpoints (auth flows, bird, genetics, calendar, and all other feature modules are separate specs later). This spec only scaffolds structure — it does not implement domain behavior. Module folders may exist as empty placeholders, but no controllers, services, or DTOs with business logic are created here.

## Glossary

- **Monorepo**: The single GitHub repository named `avyo` that contains all applications and internal packages.
- **Workspace**: A pnpm workspace member declared in `pnpm-workspace.yaml`, located under `apps/*` or `packages/*`.
- **Root_Package**: The top-level `package.json` at the monorepo root that holds orchestrator scripts and shared devDependencies.
- **Api_App**: The NestJS 11 application located at `apps/api`, package name `@avyo/api`.
- **Web_App**: The Next.js 15 application located at `apps/web`, package name `@avyo/web`.
- **Types_Package**: The shared contract library located at `packages/types`, package name `@avyo/types`.
- **Eslint_Config_Package**: The shared ESLint configuration library located at `packages/config-eslint`.
- **Tsconfig_Config_Package**: The shared base TypeScript configuration library located at `packages/config-tsconfig`.
- **Pagination_Envelope**: The paginated response contract with `data`, `links`, and `meta` fields, per `mvp-project.md` section 6.
- **Error_Envelope**: The standard error response contract with `error.code`, `error.message`, and `error.details` fields, per `mvp-project.md` section 6.
- **CI_Pipeline**: The GitHub Actions workflow at `.github/workflows/ci.yml` that runs lint, typecheck, test, and build.
- **Railway_Project**: The single Railway project hosting the `api`, `web`, and `postgres` services on a private network.
- **Env_Example_File**: A versioned `.env.example` file documenting the environment variables required by an app, without secret values.
- **MVP_Modules**: The module set defined in `structure.md` and `mvp-project.md` section 4: `auth`, `bird`, `genetics`, `calendar`, `band`, `band-color`, `cage`, `species`, `official-color`, `color-class`, `status`, `management`, `aviary`.

## Requirements

### Requirement 1: Monorepo and pnpm Workspaces

**User Story:** As a developer, I want a single pnpm-workspace monorepo, so that the API, web app, and shared packages live in one repository with shared tooling and shared types.

#### Acceptance Criteria

1. THE Monorepo SHALL provide a `pnpm-workspace.yaml` file located at the repository root that declares exactly two workspace globs, `apps/*` and `packages/*`, and no other globs.
2. THE Monorepo SHALL resolve, through the declared globs, exactly the workspace members `apps/api`, `apps/web`, `packages/types`, `packages/config-eslint`, and `packages/config-tsconfig`.
3. THE Api_App SHALL declare the package name `@avyo/api` in its `package.json`.
4. THE Web_App SHALL declare the package name `@avyo/web` in its `package.json`.
5. THE Types_Package SHALL declare the package name `@avyo/types` in its `package.json`.
6. WHERE a workspace declares a dependency on the shared contract package, THE workspace SHALL reference `@avyo/types` using the pnpm workspace protocol (a `workspace:` prefixed specifier) instead of a published version range or a duplicated copy of the contract.
7. THE Monorepo SHALL provide a `package.json` file at the root of each of the five workspace member directories (`apps/api`, `apps/web`, `packages/types`, `packages/config-eslint`, `packages/config-tsconfig`), each declaring a `name` field.

### Requirement 2: Runtime and Language Version Locking

**User Story:** As a developer, I want Node and TypeScript versions locked, so that every environment and CI run uses the versions validated in the compatibility matrix.

#### Acceptance Criteria

1. THE Monorepo SHALL contain a `.nvmrc` file at the repository root whose only content is the exact string `22`.
2. THE Root_Package SHALL declare an `engines.node` constraint requiring Node.js version 22 or higher (`>=22`).
3. THE Monorepo SHALL configure TypeScript at a version greater than or equal to 5.6 and less than 6.0 in every workspace package located under `apps/*` and `packages/*`.
4. THE Root_Package SHALL declare `pnpm` as the package manager through the `packageManager` field.
5. IF the active Node.js runtime version does not satisfy the `engines.node` constraint, THEN THE Monorepo SHALL cause the dependency install to fail and return an error message indicating the Node.js version mismatch, without installing dependencies.

### Requirement 3: Root Package Orchestration

**User Story:** As a developer, I want root-level orchestrator scripts and shared devDependencies, so that I can run lint, typecheck, test, and build across all workspaces from the repository root.

#### Acceptance Criteria

1. WHEN the `lint` script is executed from the repository root, THE Root_Package SHALL run linting in every workspace declared in the pnpm workspace configuration (all packages under `apps/*` and `packages/*`).
2. WHEN the `typecheck` script is executed from the repository root, THE Root_Package SHALL run TypeScript type checking in every workspace declared in the pnpm workspace configuration (all packages under `apps/*` and `packages/*`).
3. WHEN the `test` script is executed from the repository root, THE Root_Package SHALL run the test suite in every workspace declared in the pnpm workspace configuration (all packages under `apps/*` and `packages/*`).
4. WHEN the `build` script is executed from the repository root, THE Root_Package SHALL build every deployable workspace under `apps/` (`@avyo/api` and `@avyo/web`).
5. IF any workspace reports a failure during execution of the `lint`, `typecheck`, `test`, or `build` script, THEN THE Root_Package SHALL terminate that script with a non-zero exit code and produce output identifying which workspace failed.
6. THE Root_Package SHALL declare TypeScript (version 5.6 or higher), ESLint, and Prettier as shared development dependencies available to all workspaces.
7. THE Root_Package SHALL set its `private` field to `true` so that it cannot be published to a package registry.

### Requirement 4: Shared ESLint Configuration Package

**User Story:** As a developer, I want a shared ESLint config package, so that all apps and packages enforce one consistent set of lint rules.

#### Acceptance Criteria

1. THE Eslint_Config_Package SHALL export a single reusable ESLint configuration entry that is resolvable by name as a workspace dependency by every consuming app and package.
2. WHEN the Api_App resolves its lint configuration, THE Api_App SHALL load and apply the rule set exported by Eslint_Config_Package without redefining or overriding any of those rules locally.
3. WHEN the Web_App resolves its lint configuration, THE Web_App SHALL load and apply the rule set exported by Eslint_Config_Package without redefining or overriding any of those rules locally.
4. WHEN the Types_Package resolves its lint configuration, THE Types_Package SHALL load and apply the rule set exported by Eslint_Config_Package without redefining or overriding any of those rules locally.
5. THE Eslint_Config_Package SHALL be referenced by every consuming app and package at the exact same resolved version, such that all consumers apply an identical rule set.
6. IF a consuming app or package cannot resolve or load the configuration exported by Eslint_Config_Package, THEN THE consuming app or package SHALL fail its lint execution with a non-zero exit status and produce an error output indicating that the shared configuration could not be resolved, without applying a partial or fallback rule set.

### Requirement 5: Shared Base TypeScript Configuration Package

**User Story:** As a developer, I want a shared base tsconfig package, so that all apps and packages inherit consistent compiler options.

#### Acceptance Criteria

1. THE Tsconfig_Config_Package SHALL provide a base TypeScript configuration that targets TypeScript 5.6 or higher and enables strict type-checking compiler options.
2. WHEN the Api_App resolves its TypeScript configuration, THE Api_App SHALL extend the base configuration from Tsconfig_Config_Package and apply its inherited options except where explicitly overridden.
3. WHEN the Web_App resolves its TypeScript configuration, THE Web_App SHALL extend the base configuration from Tsconfig_Config_Package and apply its inherited options except where explicitly overridden.
4. WHEN the Types_Package resolves its TypeScript configuration, THE Types_Package SHALL extend the base configuration from Tsconfig_Config_Package and apply its inherited options except where explicitly overridden.
5. IF a consuming workspace cannot resolve the base configuration from Tsconfig_Config_Package, THEN THE consuming workspace SHALL fail its type-check with an error indicating the base configuration could not be located, without producing build output.
6. WHERE a consuming workspace overrides a base compiler option, THE consuming workspace SHALL apply the overriding value while retaining all non-overridden base options.

### Requirement 6: Shared Contract Skeleton (@avyo/types)

**User Story:** As a developer, I want the shared contract skeleton established in `@avyo/types`, so that the web and API sides import enums and response envelopes from a single source without duplication.

#### Acceptance Criteria

1. THE Types_Package SHALL export a `sex` enum with exactly two members, `M` and `F`, and no additional members, per `mvp-project.md` section 5.2.
2. THE Types_Package SHALL export an `age_group` enum with exactly two members, `young` and `adult`, and no additional members, per `mvp-project.md` section 5.2.
3. THE Types_Package SHALL export a Pagination_Envelope type containing a `data` field, a `links` field with `first`, `last`, `prev`, and `next`, and a `meta` field with `current_page`, `from`, `last_page`, `per_page`, `to`, and `total`, per `mvp-project.md` section 6.
4. THE Types_Package SHALL define the Pagination_Envelope `links.prev`, `links.next`, `meta.from`, and `meta.to` fields as nullable, and the `meta` count fields (`current_page`, `last_page`, `per_page`, `total`) as non-negative integers.
5. THE Types_Package SHALL export an Error_Envelope type containing an `error` field with a string `code`, a string `message`, and a `details` field that is omitted when empty or otherwise a list of `field`/`message` entries, per `mvp-project.md` section 6.
6. THE Types_Package SHALL name all exported contract fields in snake_case, matching the API body contract described in `mvp-project.md` section 6.
7. WHEN a consuming workspace imports from the `@avyo/types` package entry point, THE Types_Package SHALL resolve the `sex` enum, the `age_group` enum, the Pagination_Envelope type, and the Error_Envelope type without requiring deep or subpath imports.

### Requirement 7: API Application Skeleton (NestJS 11)

**User Story:** As a developer, I want a NestJS 11 API skeleton with the conventional directory structure, so that subsequent feature specs can add modules without reworking the foundation.

#### Acceptance Criteria

1. THE Api_App SHALL provide a `src/main.ts` bootstrap entry point that starts an HTTP server listening on the port defined by the `PORT` environment variable.
2. THE Api_App SHALL provide a `src/app.module.ts` root module that imports the configuration module and registers all MVP_Modules.
3. THE Api_App SHALL provide a `src/common/` directory containing exactly five subdirectories `guards/`, `interceptors/`, `filters/`, `decorators/`, and `prisma/`, per `structure.md` and `mvp-project.md` section 10.2.
4. THE Api_App SHALL provide a `src/config/` directory that validates the presence and type of every required environment variable at bootstrap.
5. IF any required environment variable is missing or fails validation, THEN THE Api_App SHALL abort startup, produce an error indicating each offending variable, and not begin listening for HTTP requests.
6. THE Api_App SHALL provide a `src/modules/` directory containing exactly one placeholder module folder for each of the MVP_Modules (`auth`, `bird`, `genetics`, `calendar`, `band`, `band-color`, `cage`, `species`, `official-color`, `color-class`, `status`, `management`, `aviary`), where each placeholder module contains at minimum a `*.module.ts` registered in `src/app.module.ts`.
7. WHEN the Api_App is built with `pnpm --filter @avyo/api build`, THE Api_App SHALL complete with a zero exit code, report no compilation errors, and produce build output.
8. THE Api_App SHALL depend on NestJS at version 11.x (>= 11.0.0 and < 12.0.0), per `tech.md`.

### Requirement 8: API Prisma 6 Setup

**User Story:** As a developer, I want the Prisma 6 setup scaffolded in the API, so that database schema and migrations can be added by later specs and applied on deploy.

#### Acceptance Criteria

1. THE Api_App SHALL provide a `prisma/schema.prisma` file configured with a datasource using the `postgresql` provider and a generator that produces the Prisma Client.
2. THE Api_App SHALL provide a `prisma/migrations/` directory for versioned migrations.
3. THE Api_App SHALL provide a `prisma/seed.ts` placeholder seed script that, WHEN executed, runs to completion, exits with a success status, and writes no records, serving as a placeholder for seeding global catalogs (official colors, color classes) and default lookups (status, management) to be added by later specs, per `mvp-project.md` section 10.2.
4. THE Api_App SHALL register `prisma/seed.ts` as the project's Prisma seed command so that it is invoked by the Prisma seed workflow.
5. THE Api_App SHALL depend on Prisma ORM (Prisma CLI) and Prisma Client at version 6.x (>= 6.0.0 and < 7.0.0), per `tech.md`.
6. THE Api_App SHALL configure the `prisma/schema.prisma` datasource to read its connection string from the `DATABASE_URL` environment variable.
7. WHEN `prisma generate` runs against `prisma/schema.prisma`, THE Api_App SHALL produce the Prisma Client without schema validation errors.

### Requirement 9: API Environment Example File

**User Story:** As a developer, I want a documented `.env.example` for the API, so that required configuration is discoverable without committing secrets.

#### Acceptance Criteria

1. THE Api_App SHALL provide an Env_Example_File at `apps/api/.env.example`.
2. THE Api_App Env_Example_File SHALL include a key entry for each of the variables `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_SECRET`, `REFRESH_EXPIRES_IN`, `PORT`, at least one variable in the `CAPTCHA_*` group, and at least one variable in the `MAIL_*` group, per `devops.md` and `mvp-project.md` section 11.4.
3. THE Api_App Env_Example_File SHALL assign every listed variable a non-empty illustrative placeholder value.
4. IF a variable's value would be a valid production credential, connection string, or secret sourced from a real environment, THEN THE Api_App Env_Example_File SHALL exclude that value and use an illustrative placeholder instead.
5. THE Api_App Env_Example_File SHALL accompany each variable (or `CAPTCHA_*`/`MAIL_*` group) with a comment describing its purpose so that its required configuration is discoverable.

### Requirement 10: Web Application Skeleton (Next.js 15)

**User Story:** As a developer, I want a Next.js 15 App Router skeleton with the conventional structure and locked frontend libraries, so that feature pages and components can be added on a stable base.

#### Acceptance Criteria

1. THE Web_App SHALL provide a `src/app/` directory containing a root layout file and a root page file recognized by the Next.js App Router.
2. THE Web_App SHALL provide a `src/components/ui/` directory initialized for shadcn/ui components.
3. THE Web_App SHALL provide a `src/lib/` directory containing an API client module that reads its base URL from the `NEXT_PUBLIC_API_URL` environment variable and a TanStack Query provider that instantiates a QueryClient and wraps the App Router tree.
4. THE Web_App SHALL provide a `src/hooks/` directory for shared React hooks.
5. THE Web_App SHALL configure TailwindCSS version 4.x such that Tailwind utility classes are processed and applied in the App Router output.
6. THE Web_App SHALL declare the package name `@avyo/web` and depend on Next.js 15.x, React 19.x, React DOM 19.x, TanStack Query 5.x, and shadcn/ui, per `tech.md`.
7. WHEN the Web_App is built with `pnpm --filter @avyo/web build` on Node.js 22 LTS, THE Web_App SHALL complete with a zero exit code and report no compilation errors.
8. IF the Web_App build or type-check fails, THEN THE Web_App SHALL exit with a non-zero status, produce an error message identifying the failing file or module, and not emit a deployable artifact.

### Requirement 11: Web Environment Example File

**User Story:** As a developer, I want a documented `.env.example` for the web app, so that required public configuration is discoverable without committing secrets.

#### Acceptance Criteria

1. THE Web_App SHALL provide an Env_Example_File at `apps/web/.env.example`.
2. THE Web_App Env_Example_File SHALL list exactly the two variables `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_CAPTCHA_SITE_KEY`, each on its own line as `key=placeholder`, per `devops.md` and `mvp-project.md` section 11.4.
3. THE Web_App Env_Example_File SHALL assign each variable a non-empty illustrative value that is not a real API URL or a real captcha site key.
4. THE Web_App Env_Example_File SHALL express the `NEXT_PUBLIC_API_URL` placeholder as an example absolute HTTP or HTTPS URL.

### Requirement 12: Continuous Integration Pipeline

**User Story:** As a developer, I want a CI pipeline that validates every change, so that lint, type, test, and build regressions are caught before merge.

#### Acceptance Criteria

1. THE CI_Pipeline SHALL be defined in `.github/workflows/ci.yml`.
2. WHEN the CI_Pipeline is triggered, THE CI_Pipeline SHALL run `lint`, `typecheck`, `test`, and `build` for each affected app and package.
3. THE CI_Pipeline SHALL use pnpm with dependency caching enabled.
4. THE CI_Pipeline SHALL use Node.js version 22, matching the `.nvmrc` content.
5. WHERE only a subset of paths changes, THE CI_Pipeline SHALL run only the changed workspaces plus their dependents and skip all unaffected workspaces.
6. WHEN a pull request targets the `main` branch, THE CI_Pipeline SHALL run automatically without manual intervention.
7. IF any CI stage exits with a non-zero status, THEN THE CI_Pipeline SHALL report a failed check and SHALL NOT report the run as passing.
8. WHEN all CI stages pass, THE CI_Pipeline SHALL report a passing check status.

### Requirement 13: Railway Deploy Configuration

**User Story:** As a developer, I want the Railway deploy configuration documented and scaffolded, so that the API, web, and database deploy from the monorepo with correct roots and private networking.

#### Acceptance Criteria

1. THE Railway_Project SHALL define exactly three services named `api`, `web`, and `postgres`, per `devops.md` and `mvp-project.md` section 10.4.
2. THE Railway_Project SHALL configure the `api` service with root directory `apps/api`, build command `pnpm --filter @avyo/api build`, and public domain `api.avyo.cloud`.
3. THE Railway_Project SHALL configure the `web` service with root directory `apps/web`, build command `pnpm --filter @avyo/web build`, and public domain `app.avyo.cloud`.
4. THE Railway_Project SHALL provision `postgres` as a managed plugin with no publicly exposed domain or port.
5. THE Railway_Project SHALL restrict inter-service communication with `postgres` to the private network only.
6. WHEN a push to the `main` branch changes only a subset of service paths, THE Railway_Project SHALL rebuild and redeploy only the affected services.
7. WHEN the `api` service deploys, THE `api` service SHALL apply all pending migrations using `prisma migrate deploy` before serving traffic.
8. IF `prisma migrate deploy` fails during an `api` deploy, THEN THE Railway_Project SHALL abort the deploy, keep the previously running version, and surface the failure in the deploy logs.
9. THE deploy configuration documentation SHALL state that `DATABASE_URL` and all other secrets are set as Railway service environment variables, are not committed to the repository, and that only `.env.example` files are versioned.

### Requirement 14: Repository Hygiene and Secret Protection

**User Story:** As a developer, I want repository hygiene rules enforced, so that secrets are never committed and the main branch stays protected.

#### Acceptance Criteria

1. THE Monorepo SHALL provide a `.gitignore` at the repository root that excludes `.env` and `.env.*` variant files (except `.env.example`), `node_modules`, and build output directories (`dist`, `.next`, `build`).
2. THE Monorepo SHALL exclude `.env` and `.env.*` variant files from version control while preserving `.env.example` files as versioned.
3. THE deploy and contribution documentation SHALL state that the `main` branch is protected, that direct pushes to `main` are not permitted, and that changes are integrated through pull requests from feature branches.
4. WHEN an untracked `.env` or `.env.*` secret file exists in the working tree, THE `.gitignore` configuration SHALL exclude that file from staging.
5. IF a secret file is already tracked in version control, THEN THE contribution documentation SHALL provide untracking guidance so that the file ends up excluded from version control.
