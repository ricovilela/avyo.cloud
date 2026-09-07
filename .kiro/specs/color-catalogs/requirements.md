# Requirements Document

## Introduction

The Color Catalogs feature covers the two global, official reference catalogs of the Avyo bird-breeding MVP: Color Class (`color-class` / Classe de Cor) and Official Color (`official-color` / Cor Oficial). Unlike the tenant-scoped business modules, these catalogs are global and official: they carry no `user_id`, are shared identically across every tenant, and are populated by the Prisma seed script (`apps/api/prisma/seed.ts`) rather than by tenant CRUD.

From the API consumer's perspective these catalogs are read-only, exposed through `GET /color-class` and `GET /official-color`. A Color Class groups many Official Colors (1:N), and each Official Color belongs to exactly one Color Class, carries an `age_group` native Postgres enum (`young` / `adult` — jovem / adulta), a `code` (official code), and a `title`. The same color can therefore exist in both young and adult variants and be grouped under a class.

Both endpoints require Bearer JWT authentication (reusing the existing `auth` module: guards, filters, PrismaService, snake_case interceptor) but return global data with no tenant filtering. All response bodies use `snake_case`, follow the shared pagination and error envelopes, and reference shared contract types in `packages/types` (`@avyo/types`).

The modules live at `apps/api/src/modules/color-class/` and `apps/api/src/modules/official-color/` (NestJS 11 + Prisma 6 + PostgreSQL 17). This feature is scoped to the two catalogs and their seeding; the `bird_color` junction (N:N between `bird` and `official_color`) is out of scope and belongs to the bird spec.

Canonical source of truth: `mvp-project.md` (sections 4.3, 5, 6, and 11.2).

## Glossary

- **Color_Catalog_System**: The combined `color-class` and `official-color` modules (`apps/api/src/modules/color-class/` and `apps/api/src/modules/official-color/`) that expose the `GET /color-class` and `GET /official-color` endpoints.
- **Color_Class**: A global, official record in the `color_class` table representing a background/grouping category of bird colors (for example fundo branco, fundo amarelo, fundo pastel). Has a UUID `id`, a `name`, and a `code`. Carries no `user_id`.
- **Official_Color**: A global, official record in the `official_color` table representing a recognized bird color. Has a UUID `id`, a `class_id` (FK to Color_Class), an `age_group`, a `code`, and a `title`. Carries no `user_id`.
- **Age_Group**: A native PostgreSQL enum with exactly the values `young` and `adult` (jovem and adulta), assigned to every Official_Color.
- **Color_Class_Id**: The UUID foreign key on an Official_Color that references the `id` of the Color_Class to which it belongs.
- **Seed_Process**: The Prisma seed script (`apps/api/prisma/seed.ts`) that populates the global Color_Class and Official_Color catalogs.
- **Authenticated_Request**: An HTTP request carrying a valid Bearer Access_Token issued by the existing `auth` module.
- **Access_Token**: A JWT signed with HS256 by the existing `auth` module, presented in the `Authorization: Bearer <JWT>` header.
- **Verified_User**: An authenticated User whose `email_verified_at` value is a non-null timestamp.
- **Unverified_User**: An authenticated User whose `email_verified_at` value is null.
- **Pagination_Envelope**: The standard list response body `{ "data": { "<entity>": [] }, "links": { "first", "last", "prev", "next" }, "meta": { "current_page", "from", "last_page", "per_page", "to", "total" } }`.
- **Error_Envelope**: The standard error response body `{ "error": { "code", "message", "details": [] } }`.
- **Shared_Types**: The contract types defined in `packages/types` (`@avyo/types`), imported by both the API and the web app.

## Requirements

### Requirement 1: List Color Classes

**User Story:** As an authenticated breeder, I want to retrieve the global list of color classes, so that I can group and understand official bird colors by their background category.

#### Acceptance Criteria

1. WHEN an Authenticated_Request is received at `GET /color-class`, THE Color_Catalog_System SHALL respond with HTTP 200 and a body listing Color_Class records, each containing a non-null UUID `id`, a non-empty `name` string, and a non-empty `code` string.
2. THE Color_Catalog_System SHALL return every Color_Class record from the global catalog without applying any `user_id` or tenant filter, such that all authenticated users receive the identical set of Color_Class records.
3. WHEN the `color_class` table contains no records, THE Color_Catalog_System SHALL respond with HTTP 200 and an empty list of Color_Class records.
4. THE Color_Catalog_System SHALL serialize every Color_Class field name in the response body, including nested field names, in `snake_case`.
5. WHEN an Authenticated_Request is received at `GET /color-class`, THE Color_Catalog_System SHALL return the Color_Class records sorted by `code` in ascending lexicographical (Unicode code point) order, producing byte-for-byte identical ordering across repeated requests with identical query parameters.
6. IF a request is received at `GET /color-class` without a valid authentication token, THEN THE Color_Catalog_System SHALL respond with HTTP 401, SHALL NOT include any Color_Class records in the response body, and SHALL include an error indication conveying that authentication is required.
7. WHEN an Authenticated_Request is received at `GET /color-class`, THE Color_Catalog_System SHALL return the complete response within 2000 milliseconds measured from request receipt to response dispatch.

### Requirement 2: List Official Colors

**User Story:** As an authenticated breeder, I want to retrieve the global list of official colors, so that I can assign recognized colors to my birds.

#### Acceptance Criteria

1. WHEN an Authenticated_Request is received at `GET /official-color`, THE Color_Catalog_System SHALL respond with HTTP 200 and a body listing Official_Color records, each containing a non-null UUID `id`, a UUID `class_id`, an `age_group`, a non-empty `code` string of at most 50 characters, and a non-empty `title` string of at most 255 characters.
2. THE Color_Catalog_System SHALL return every Official_Color record from the global catalog without applying any `user_id` or tenant filter, such that all authenticated users receive the identical set of Official_Color records.
3. WHEN the `official_color` table contains no records, THE Color_Catalog_System SHALL respond with HTTP 200 and an empty list of Official_Color records.
4. THE Color_Catalog_System SHALL serialize every Official_Color field name in the response body, including nested field names, in `snake_case`.
5. THE Color_Catalog_System SHALL set the `age_group` field of every Official_Color in the response to exactly one of the values `young` or `adult`.
6. WHEN an Authenticated_Request is received at `GET /official-color`, THE Color_Catalog_System SHALL return the Official_Color records sorted in ascending order by `class_id`, then by `age_group`, then by `code`, producing identical ordering across repeated requests with identical query parameters.
7. IF a request is received at `GET /official-color` without a valid authentication token, THEN THE Color_Catalog_System SHALL respond with HTTP 401, SHALL NOT include any Official_Color records in the response body, and SHALL include an error indication conveying that authentication is required.

### Requirement 3: Color Class and Official Color Hierarchy

**User Story:** As an authenticated breeder, I want each official color linked to its color class, so that I can see colors organized by class and by age group.

#### Acceptance Criteria

1. THE Color_Catalog_System SHALL ensure that every persisted Official_Color record has a `class_id` that references the `id` of an existing Color_Class.
2. WHERE a request to `GET /official-color` includes a `class_id` query parameter equal to the `id` of an existing Color_Class, THE Color_Catalog_System SHALL respond with HTTP 200 and return only the Official_Color records whose `class_id` equals that value.
3. IF a request to `GET /official-color` includes a `class_id` query parameter that is not a valid UUID, THEN THE Color_Catalog_System SHALL respond with HTTP 400 and an Error_Envelope with code `VALIDATION_ERROR`.
4. WHERE a request to `GET /official-color` includes a `class_id` query parameter that is a valid UUID matching no existing Color_Class, THE Color_Catalog_System SHALL respond with HTTP 200 and an empty list of Official_Color records.
5. THE Color_Catalog_System SHALL permit two or more Official_Color records that share the same `class_id` and the same `code` to differ only by `age_group`, where `age_group` is exactly one of the values `young` or `adult`, so that a single color can exist in both a `young` and an `adult` variant under the same Color_Class.
6. IF a request to create or update an Official_Color supplies a `class_id` that does not reference the `id` of an existing Color_Class, THEN THE Color_Catalog_System SHALL respond with HTTP 400 and an Error_Envelope with code `VALIDATION_ERROR`, and SHALL NOT persist the record.
7. IF a request to create or update an Official_Color would produce a record whose `class_id`, `code`, and `age_group` all match those of an existing Official_Color record, THEN THE Color_Catalog_System SHALL respond with HTTP 409 and an Error_Envelope indicating a duplicate conflict, and SHALL retain the existing record unchanged.
8. IF a request to create or update an Official_Color supplies an `age_group` value that is neither `young` nor `adult`, THEN THE Color_Catalog_System SHALL respond with HTTP 400 and an Error_Envelope with code `VALIDATION_ERROR`, and SHALL NOT persist the record.

### Requirement 4: Filter Official Colors by Age Group

**User Story:** As an authenticated breeder, I want to filter official colors by age group, so that I can find the young or adult variant I need.

#### Acceptance Criteria

1. WHERE a request to `GET /official-color` includes an `age_group` query parameter whose value exactly (case-sensitively) equals `young` or `adult`, THE Color_Catalog_System SHALL respond with HTTP 200 and return only the Official_Color records whose `age_group` equals that value.
2. IF a request to `GET /official-color` includes an `age_group` query parameter whose value is neither `young` nor `adult` (including empty, whitespace-only, or differently-cased values such as `Young` or `ADULT`), THEN THE Color_Catalog_System SHALL respond with HTTP 400 and an Error_Envelope with code `VALIDATION_ERROR`, and SHALL NOT return any Official_Color records.
3. WHERE a request to `GET /official-color` includes both a `class_id` query parameter that is a valid UUID matching an existing Color_Class and an `age_group` query parameter equal to `young` or `adult`, THE Color_Catalog_System SHALL respond with HTTP 200 and return only the Official_Color records whose `class_id` and `age_group` both match the supplied values.
4. WHERE a request to `GET /official-color` includes an `age_group` query parameter equal to `young` or `adult` that matches no Official_Color record, THE Color_Catalog_System SHALL respond with HTTP 200 and an empty list of Official_Color records.

### Requirement 5: Authentication Enforcement

**User Story:** As the platform operator, I want the color catalog endpoints to require authentication, so that only authenticated users can read the global catalogs.

#### Acceptance Criteria

1. IF a request to `GET /color-class` or `GET /official-color` is received without an `Authorization` header, with an `Authorization` header that is not of the `Bearer` scheme, or with an Access_Token that is not syntactically valid, whose signature does not verify, or whose expiry time has passed, THEN THE Color_Catalog_System SHALL respond with HTTP 401 and an Error_Envelope whose `code` field equals `UNAUTHENTICATED`, SHALL NOT establish an authenticated user context for the request, and SHALL NOT include any catalog records in the response body.
2. WHEN a request to `GET /color-class` or `GET /official-color` is received with an Access_Token that is syntactically valid, whose signature verifies, and whose expiry time has not passed, THE Color_Catalog_System SHALL evaluate the email-verification rules in criteria 3 and 4 before returning any catalog records.
3. IF a request to `GET /color-class` or `GET /official-color` is authenticated by an Unverified_User, THEN THE Color_Catalog_System SHALL respond with HTTP 403 and an Error_Envelope whose `code` field equals `EMAIL_NOT_VERIFIED`, and SHALL NOT include any catalog records in the response body.
4. WHEN a request to `GET /color-class` or `GET /official-color` is authenticated by a Verified_User, THE Color_Catalog_System SHALL return the requested global catalog records subject to the remaining rules of this specification.

### Requirement 6: Seeding the Global Catalog

**User Story:** As the platform operator, I want the color classes and official colors loaded by the seed script, so that the global catalogs are available without tenant data entry.

#### Acceptance Criteria

1. WHEN the Seed_Process runs, THE Seed_Process SHALL create exactly the defined set of Color_Class records in the `color_class` table and exactly the defined set of Official_Color records in the `official_color` table, and SHALL NOT create any Color_Class or Official_Color record that is not part of those defined sets.
2. WHEN the Seed_Process creates an Official_Color, THE Seed_Process SHALL set its `class_id` to the `id` of a Color_Class that the Seed_Process has already created.
3. WHEN the Seed_Process runs more than once against the same database, THE Seed_Process SHALL leave the `color_class` and `official_color` tables with the same set of records as a single run produces, without creating duplicate records and without modifying the primary key of any record created by a previous run.
4. WHEN the Seed_Process creates a Color_Class or an Official_Color, THE Seed_Process SHALL assign a version-4 UUID as the record's primary key.
5. WHEN the Seed_Process creates an Official_Color, THE Seed_Process SHALL set its `age_group` to exactly one of the values `young` or `adult`, and SHALL reject any Official_Color whose `age_group` is not one of those two values.
6. IF the Seed_Process cannot resolve a Color_Class for an Official_Color it is about to create, THEN THE Seed_Process SHALL abort without persisting that Official_Color, SHALL leave the `color_class` and `official_color` tables in the same state as before the run began, and SHALL report an error indicating the Official_Color and the unresolved Color_Class reference.
7. IF the Seed_Process fails to persist any Color_Class or Official_Color record due to a database error, THEN THE Seed_Process SHALL abort, SHALL leave the `color_class` and `official_color` tables in the same state as before the run began, and SHALL report an error indicating the failed operation.

### Requirement 7: Shared Types and Response Contract

**User Story:** As a frontend developer, I want the catalog contracts defined once in shared types, so that the web and API stay consistent.

#### Acceptance Criteria

1. THE Color_Catalog_System SHALL define, as Shared_Types in `packages/types` (`@avyo/types`), the Color_Class response shape (fields `id`, `name`, and `code`), the Official_Color response shape (fields `id`, `class_id`, `age_group`, `code`, and `title`), and the Age_Group enum.
2. THE Color_Catalog_System SHALL reference the Color_Class response shape, the Official_Color response shape, and the Age_Group enum from the Shared_Types in `packages/types` (`@avyo/types`) and SHALL NOT redefine any of these contracts within the API module.
3. THE Shared_Types SHALL express the Age_Group enum with exactly the two values `young` and `adult` and no other value.
4. THE Color_Catalog_System SHALL serialize all response body field names, including nested field names, in `snake_case`.
5. WHEN the Color_Catalog_System returns a list response for `GET /color-class` or `GET /official-color`, THE Color_Catalog_System SHALL format the body according to the Pagination_Envelope, such that the body contains exactly the top-level keys `data`, `links`, and `meta`, where the `data` object contains exactly one key named for the entity (`color_class` for `GET /color-class` and `official_color` for `GET /official-color`) whose value is the array of records.

### Requirement 8: Error Handling Contract

**User Story:** As a frontend developer, I want consistent error responses from the catalog endpoints, so that I can build reliable client handling.

#### Acceptance Criteria

1. WHEN the Color_Catalog_System returns any error response, THE Color_Catalog_System SHALL format the body as an Error_Envelope containing exactly the keys `error.code` (a string), `error.message` (a string of 1 to 500 characters), and `error.details` (an array of 0 to 100 entries).
2. WHEN the Color_Catalog_System returns any error response, THE Color_Catalog_System SHALL set `error.code` to exactly one value from the set `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `EMAIL_NOT_VERIFIED`, `NOT_FOUND`, `RATE_LIMITED`, and `INTERNAL`.
3. WHEN a validation error includes field-level detail, THE Color_Catalog_System SHALL populate `error.details` with one entry per invalid field, each entry containing exactly a `field` name (a snake_case string of 1 to 100 characters) and a `message` (a string of 1 to 500 characters).
4. WHEN an error response has no field-level detail, THE Color_Catalog_System SHALL set `error.details` to an empty array.
5. IF the Color_Catalog_System encounters an error that does not map to a specific Error_Envelope code, THEN THE Color_Catalog_System SHALL respond with HTTP 500 and an Error_Envelope with code `INTERNAL`.
6. WHEN the Color_Catalog_System returns an Error_Envelope with code `INTERNAL`, THE Color_Catalog_System SHALL set `error.message` to a generic message that excludes stack traces, exception class names, and other internal implementation detail, and SHALL set `error.details` to an empty array.

## Open Decisions

The following decisions are recorded from `mvp-project.md` sections 6 and 11.2. They do not block requirements approval but MUST be resolved before implementation of the affected areas:

- **Pagination vs. simple list**: `mvp-project.md` section 6 lists `/official-color` and `/color-class` under "Globais/oficiais" lookups and describes list endpoints using the Pagination_Envelope, while also listing several simple-object endpoints as non-paginated. Because these global catalogs are small and stable, whether they return the full Pagination_Envelope or a simple list must be confirmed. Requirement 7 assumes the Pagination_Envelope; if a simple list is chosen instead, Requirement 7 criterion 4 must be revised.
- **Catalog source data**: The origin and exact contents of the official colors and color classes loaded by the Seed_Process (Requirement 6) are not yet fixed (`mvp-project.md` section 11.2). The concrete seed dataset must be provided before seeding is implemented.
- **Email-verification gating**: Requirement 5 criterion 3 applies the `EMAIL_NOT_VERIFIED` business-route gating (`mvp-project.md` section 3.3) to these endpoints. Confirm whether the global catalog lookups are considered Business_Routes subject to that gate or are accessible to any authenticated user regardless of email verification.
- **List query parameters**: Beyond `class_id` and `age_group` filtering, any additional filter, search, or sort query parameters for these endpoints are not yet specified (`mvp-project.md` section 11.3).
