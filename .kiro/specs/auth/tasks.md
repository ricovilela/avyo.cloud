# Implementation Plan: Authentication Module (auth)

## Overview

This plan implements the `auth` module incrementally on the locked stack (NestJS 11, @nestjs/jwt + Passport, Prisma 6, PostgreSQL 17, TypeScript 5.6+, pnpm monorepo). It builds from the outside in: confirm/install new dependencies, then shared contract types, then data layer (Prisma models + migration), then cross-cutting `common/` infrastructure (error filter, snake_case interceptor, PrismaService), then the provider-agnostic ports with in-memory/dev fakes, then the domain services (hashing, tokens, refresh rotation), then the JWT strategy and guards, then `AuthService` and the controller wired endpoint by endpoint, and finally full module wiring and end-to-end integration tests.

Each coding task references specific requirement sub-clauses and, where applicable, the correctness property numbers it implements or validates. Property-based tests use `fast-check` (min 100 iterations), one property per test, tagged `// Feature: auth, Property {number}: {property_text}`, with in-memory fakes for Prisma and the `CaptchaVerifier`/`Mailer`/`RateLimiter` ports.

## Tasks

- [x] 1. Confirm and install new dependencies
  - Add runtime dependency `argon2` (Argon2id password hashing) to `apps/api/package.json`.
  - Add dev dependencies `fast-check` (property-based testing) and `supertest` + `@types/supertest` (e2e HTTP assertions) to `apps/api/package.json`.
  - Add the rate-limiting backing dependency (`@nestjs/throttler` candidate) as a runtime dependency, to be used behind the `RateLimiter` port; if approval is pending, keep the port implemented by an in-memory fake only and leave a config-driven binding stub.
  - Add `passport`, `passport-jwt`, `@nestjs/passport`, `@nestjs/jwt`, `class-validator`, `class-transformer`, and `@types/passport-jwt` to align with the design's Passport/JWT and validation usage.
  - Run `pnpm install` and confirm versions are compatible with Node 22 / TS 5.6.
  - _Requirements: 10.1, 10.3_

- [x] 2. Define shared contract types in `@avyo/types`
  - [x] 2.1 Add snake_case request/response and error contract types
    - Create/extend `packages/types` with `SignupResponse`, `LoginResponse`, `AuthMeResponse`, `MenuEntry`, `ErrorEnvelope`, `ErrorDetail`, `ErrorCode` (allowed code union), and the auth request payload shapes, all in `snake_case`.
    - Export the allowed `ErrorCode` set: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `EMAIL_NOT_VERIFIED`, `NOT_FOUND`, `CONFLICT`, `UNPROCESSABLE`, `RATE_LIMITED`, `INTERNAL`.
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 3. Add Prisma data models and migration
  - [x] 3.1 Add `User`, `RefreshToken`, `EmailVerificationToken`, `PasswordResetToken` models
    - Edit `apps/api/prisma/schema.prisma` per the design: UUID PKs via `gen_random_uuid()`, snake_case `@map` names, `timestamptz(6)` timestamps, `user` unique `email` (VarChar 254), `password_hash`, nullable `email_verified_at`, `plan` default `ctrlsale`.
    - Model `refresh_token` with `token_hash` unique, `chain_id`, unique `parent_id` self-relation (`RefreshChain` parent→successor), `revoked`, `expires_at`, device columns (`user_agent`, `os`, `browser`), and `@@index` on `user_id` and `chain_id`.
    - Model `email_verification_token` and `password_reset_token` with `token_hash` unique, `expires_at`, `used_at`, `@@index` on `user_id`.
    - _Requirements: 1.1, 2.3, 5.1, 7.1, 11.3_
  - [x] 3.2 Generate the Prisma migration and client
    - Run `prisma migrate dev` to create the migration under `apps/api/prisma/migrations/` and regenerate the Prisma client.
    - _Requirements: 11.3_

- [x] 4. Implement cross-cutting infrastructure in `common/`
  - [x] 4.1 Implement `PrismaService`
    - Create `apps/api/src/common/prisma/prisma.service.ts` extending `PrismaClient` with Nest lifecycle hooks (`onModuleInit`/`onModuleDestroy`).
    - _Requirements: 1.1_
  - [x] 4.2 Implement `AppException` hierarchy and `AllExceptionsFilter`
    - Create `apps/api/src/common/filters/all-exceptions.filter.ts` and an `AppException` type carrying an allowed `ErrorCode`; map known exceptions to their code/HTTP status and unmapped errors to `500 INTERNAL` with a generic message (no stack/internal leak).
    - Transform Nest `ValidationPipe` errors into `VALIDATION_ERROR` with one `{ field (snake_case), message }` entry per invalid field; set `details: []` when there is no field-level detail.
    - _Requirements: 12.1, 12.2, 12.4, 12.5, 12.6_
  - [x] 4.3 Write property test for the error envelope contract
    - **Property 31: Error responses conform to the envelope contract**
    - **Validates: Requirements 12.1, 12.2, 12.4, 12.5**
  - [x] 4.4 Implement `SnakeCaseInterceptor`
    - Create `apps/api/src/common/interceptors/snake-case.interceptor.ts` that recursively converts all success response body keys (including nested) to `snake_case`.
    - _Requirements: 12.3_
  - [x] 4.5 Write property test for snake_case serialization
    - **Property 32: All body field names are snake_case**
    - **Validates: Requirements 12.3**

- [x] 5. Extend environment validation for auth secrets
  - [x] 5.1 Ensure required auth env vars are validated at startup
    - Confirm/extend `apps/api/src/config/env.validation.ts` so `JWT_SECRET`, `REFRESH_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_EXPIRES_IN`, `DATABASE_URL`, `PORT` are all required and startup collects and reports every missing/empty/whitespace-only offender.
    - _Requirements: 10.6_
  - [x] 5.2 Write unit tests for env validation of auth secrets
    - Assert that omitting `JWT_SECRET` and `REFRESH_SECRET` together reports both offenders.
    - _Requirements: 10.6_

- [x] 6. Define provider-agnostic ports and in-memory/dev fakes
  - [x] 6.1 Define `CaptchaVerifier`, `Mailer`, and `RateLimiter` port interfaces and DI tokens
    - Create `apps/api/src/modules/auth/ports/captcha-verifier.ts`, `mailer.ts`, `rate-limiter.ts` with the interfaces and `Symbol` tokens from the design.
    - _Requirements: 1.7, 1.4, 9.1_
  - [x] 6.2 Implement in-memory/dev fakes and config-driven binding stubs
    - Provide test/dev fake implementations (always-pass captcha for dev, recording mailer, in-memory rolling-window rate limiter) usable in tests and as default wiring until concrete providers are chosen.
    - _Requirements: 6.2, 9.1_

- [x] 7. Implement password hashing
  - [x] 7.1 Implement `PasswordHasher` with argon2
    - Create `apps/api/src/modules/auth/password.hasher.ts` implementing `hash(plain)` and `verify(hash, plain)` with Argon2id; never expose plaintext or hash in responses.
    - _Requirements: 1.3_
  - [x] 7.2 Write unit tests for `PasswordHasher`
    - Test hash/verify round-trip, wrong-password rejection, and that the hash differs from the plaintext.
    - _Requirements: 1.3_

- [x] 8. Implement access-token service
  - [x] 8.1 Implement `TokenService` (HS256 access tokens)
    - Create `apps/api/src/modules/auth/token.service.ts` using `@nestjs/jwt` to sign HS256 tokens with `JWT_SECRET`, claims `sub`/`iat`/`exp`; resolve lifetime from `JWT_EXPIRES_IN` or default 86400 when absent/empty/whitespace; expose verify.
    - _Requirements: 2.2, 10.1, 10.2_
  - [x] 8.2 Write property test for access-token lifetime resolution
    - **Property 28: Access-token lifetime resolution**
    - **Validates: Requirements 10.2**
  - [x] 8.3 Write unit tests for `TokenService` sign/verify
    - Sign with a known secret and verify; assert HS256 header and rejection of tampered signatures.
    - _Requirements: 10.1, 10.4, 10.5_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement refresh-token rotation service
  - [x] 10.1 Implement `RefreshTokenService` (issue, rotate, reuse detection, chain revocation)
    - Create `apps/api/src/modules/auth/refresh-token.service.ts`: generate opaque high-entropy tokens, persist only `token_hash` derived with `REFRESH_SECRET`, create chains at login, rotate presented→successor in a transaction, detect reuse (successor exists or revoked-with-successor) and revoke the entire chain, revoke by session and revoke-all-for-user.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 10.3_
  - [x] 10.2 Write property test for rotation producing fresh, distinct tokens
    - **Property 8: Refresh rotation produces fresh, distinct tokens**
    - **Validates: Requirements 3.1**
  - [x] 10.3 Write property test for single-use invalidation of the presented token
    - **Property 9: Rotation invalidates the presented token (round-trip / single-use)**
    - **Validates: Requirements 3.2**
  - [x] 10.4 Write property test for chain revocation on reuse
    - **Property 10: Reuse of a rotated token revokes the whole chain**
    - **Validates: Requirements 3.3**
  - [x] 10.5 Write property test for isolation of other chains on invalid/revoked/expired refresh
    - **Property 11: Invalid/revoked/expired refresh isolates other chains**
    - **Validates: Requirements 3.4**

- [x] 11. Implement JWT strategy, guards, and current-user decorator
  - [x] 11.1 Implement `JwtStrategy` and `JwtAuthGuard`
    - Create `apps/api/src/modules/auth/jwt.strategy.ts` (passport-jwt) extracting the Bearer token, verifying signature/expiry against `JWT_SECRET`, returning `{ user_id }` from `sub` only; create `apps/api/src/common/guards/jwt-auth.guard.ts` binding the principal to the request and rejecting on any failure without binding tenant identity.
    - _Requirements: 10.4, 10.5, 11.1, 11.2, 11.4_
  - [x] 11.2 Implement `@CurrentUser()` decorator
    - Create `apps/api/src/common/decorators/current-user.decorator.ts` returning the bound `user_id` sourced solely from the token.
    - _Requirements: 11.4_
  - [x] 11.3 Implement `EmailVerifiedGuard`
    - Create `apps/api/src/common/guards/email-verified.guard.ts` that reads `email_verified_at` and throws `EMAIL_NOT_VERIFIED` (403) with no state change when null; assumes `JwtAuthGuard` ran first.
    - _Requirements: 5.4, 5.5_
  - [x] 11.4 Write property test for invalid/expired access-token rejection
    - **Property 29: Invalid or expired access tokens are rejected**
    - **Validates: Requirements 10.4, 10.5**
  - [x] 11.5 Write property test for tenant identity always coming from the token
    - **Property 30: Tenant identity always comes from the token**
    - **Validates: Requirements 11.1, 11.4**
  - [x] 11.6 Write property test for email-verification gating of business routes
    - **Property 18: Unverified users are gated from business routes**
    - **Validates: Requirements 5.4, 5.5**

- [x] 12. Implement rate-limiting guard
  - [x] 12.1 Implement `RateLimitGuard` over the `RateLimiter` port
    - Create the guard that counts per-endpoint by client IP and by trimmed/case-insensitive email within the rolling window, short-circuits with `429 RATE_LIMITED` before controller logic when a limit is reached, and includes a whole-second retry-after; applied only to `/auth/login`, `/auth/signup`, `/auth/forgot-password`.
    - _Requirements: 1.9, 9.1, 9.2, 9.3, 9.4, 9.5_
  - [x] 12.2 Write property test for rate-limiting thresholds and retry-after
    - **Property 27: Rate limiting triggers at configured thresholds with retry-after**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**

- [x] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Implement auth DTOs and validation
  - [x] 14.1 Create request DTOs with class-validator rules
    - Create `dto/signup.dto.ts`, `login.dto.ts`, `refresh.dto.ts`, `verify-email.dto.ts`, `forgot-password.dto.ts`, `reset-password.dto.ts` with snake_case fields and constraints: name 1–255, email 3–254 RFC 5322, password 8–128, device object with non-empty `user_agent`/`os`/`browser`, refresh_token non-empty/non-whitespace string, token ≤512 chars.
    - _Requirements: 1.6, 2.7, 3.5, 5.3, 6.3, 7.5_
  - [x] 14.2 Write property test for signup input validation
    - **Property 4: Signup input validation**
    - **Validates: Requirements 1.6**
  - [x] 14.3 Write property test for login input validation
    - **Property 7: Login input validation**
    - **Validates: Requirements 2.7**
  - [x] 14.4 Write property test for refresh input validation
    - **Property 12: Refresh input validation**
    - **Validates: Requirements 3.5**
  - [x] 14.5 Write property test for verify-email input validation
    - **Property 17: Verify-email input validation**
    - **Validates: Requirements 5.3**
  - [x] 14.6 Write property test for forgot-password input validation
    - **Property 20: Forgot-password input validation**
    - **Validates: Requirements 6.3**
  - [x] 14.7 Write property test for reset-password input validation
    - **Property 23: Reset-password input validation**
    - **Validates: Requirements 7.5**

- [x] 15. Implement `AuthService.signup` and signup endpoint
  - [x] 15.1 Implement signup flow
    - In `auth.service.ts`, normalize email to lowercase, verify captcha, reject duplicate email (case-insensitive) with `409 CONFLICT`, hash password, create user (`email_verified_at` null, `plan` ctrlsale) in a transaction rolling back on failure (`500 INTERNAL`), and trigger async verification email via `Mailer`.
    - Wire `POST /auth/signup` in `auth.controller.ts` (RateLimit guard) returning `201 { id, email, email_verified_at }` excluding password/hash.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 1.8, 1.9_
  - [x] 15.2 Write property test for signup never leaking credentials
    - **Property 1: Signup never leaks credentials**
    - **Validates: Requirements 1.3**
  - [x] 15.3 Write property test for signup output invariants
    - **Property 2: Signup output invariants**
    - **Validates: Requirements 1.1, 1.2, 11.3**
  - [x] 15.4 Write property test for case-insensitive duplicate email rejection
    - **Property 3: Duplicate email is rejected case-insensitively**
    - **Validates: Requirements 1.5**

- [x] 16. Implement `AuthService.login` and login endpoint
  - [x] 16.1 Implement login flow
    - Verify captcha and device object, look up user by normalized email, verify password (dummy-hash verify on unknown email for constant-time/anti-enumeration), issue access token + persisted refresh token (new chain), record device fingerprint; unverified users still receive tokens.
    - Wire `POST /auth/login` (RateLimit guard) returning `200 { access_token, refresh_token, token_type: bearer, expires_in: 86400 }`; unknown email and wrong password both return `401 UNAUTHENTICATED`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8_
  - [x] 16.2 Write property test for well-formed token issuance on login
    - **Property 5: Login issues well-formed tokens**
    - **Validates: Requirements 2.1, 2.2, 2.8**
  - [x] 16.3 Write property test for indistinguishable unknown-email vs wrong-password
    - **Property 6: Login is indistinguishable for unknown email vs wrong password**
    - **Validates: Requirements 2.5**

- [x] 17. Implement refresh endpoint
  - [x] 17.1 Wire `POST /auth/refresh`
    - In controller/service, validate body then delegate to `RefreshTokenService` rotation; return `200` with new tokens on success and `401 UNAUTHENTICATED` for invalid/revoked/expired/reused per the rotation algorithm (property tests already cover the state machine in task 10).
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 18. Implement logout endpoint
  - [x] 18.1 Implement `AuthService.logout` and wire `POST /auth/logout`
    - Under `JwtAuthGuard`, revoke the refresh token bound to the current session, leaving other sessions untouched; return `204` empty; idempotent when already revoked; `401 UNAUTHENTICATED` when token missing/invalid/expired with no revocation.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [x] 18.2 Write property test for logout revoking only the current session
    - **Property 13: Logout revokes only the current session**
    - **Validates: Requirements 4.1, 4.3, 4.5**
  - [x] 18.3 Write property test for logout idempotency
    - **Property 14: Logout is idempotent**
    - **Validates: Requirements 4.4**
  - [x] 18.4 Write property test for unauthenticated logout changing nothing
    - **Property 15: Unauthenticated logout changes nothing**
    - **Validates: Requirements 4.2**

- [x] 19. Implement email verification endpoint
  - [x] 19.1 Implement `AuthService.verifyEmail` and wire `POST /auth/verify-email`
    - Look up token by hash; if unused and unexpired set `email_verified_at` to now and return `204`; if unknown/used/expired leave state unchanged and return `422 UNPROCESSABLE`; validation failures return `400`.
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 19.2 Write property test for single-use, time-bounded email verification
    - **Property 16: Email verification is single-use and time-bounded**
    - **Validates: Requirements 5.1, 5.2**

- [x] 20. Implement forgot-password endpoint
  - [x] 20.1 Implement `AuthService.forgotPassword` and wire `POST /auth/forgot-password`
    - Under RateLimit guard, validate email format; always return `204` empty whether or not the account exists; dispatch reset email asynchronously only for existing accounts; apply constant-work floor (dummy lookup/hash for non-existent branch) to keep timing difference within budget.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 20.2 Write property test for account-existence indistinguishability
    - **Property 19: Forgot-password is indistinguishable regardless of account existence**
    - **Validates: Requirements 6.1, 6.2, 6.4**

- [x] 21. Implement reset-password endpoint
  - [x] 21.1 Implement `AuthService.resetPassword` and wire `POST /auth/reset-password`
    - Validate token and password (8–128); for a known/unexpired/unused token update `password_hash`, mark token used, and revoke all active refresh tokens for the user, return `204`; for expired/unknown/used token leave hash unchanged and return `422`; validation failures return `400`.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x] 21.2 Write property test for reset succeeding only for valid tokens and updating the hash
    - **Property 21: Reset-password succeeds only for valid tokens and updates the hash**
    - **Validates: Requirements 7.1, 7.4**
  - [x] 21.3 Write property test for token consumption and full session revocation
    - **Property 22: Reset-password consumes its token and revokes all sessions**
    - **Validates: Requirements 7.2, 7.3**

- [x] 22. Implement profile and dynamic menu endpoint
  - [x] 22.1 Implement `/auth/me` and the dynamic-menu builder
    - Under `JwtAuthGuard` (no email-verified gate), return `200 { user, menu }` with non-null `user.id/name/email/plan` (default `ctrlsale`), `email_verified_at` (null when unverified, ISO 8601 when verified), and an order-stable `menu` array of non-empty `key/label/route/icon`; unauthenticated/invalid/expired returns `401` with no `user`/`menu`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - [x] 22.2 Write property test for complete, order-stable profile and menu
    - **Property 24: `/auth/me` returns a complete, order-stable profile and menu**
    - **Validates: Requirements 8.1, 8.2, 8.6**
  - [x] 22.3 Write property test for `/auth/me` reflecting verification state
    - **Property 25: `/auth/me` reflects verification state**
    - **Validates: Requirements 8.4, 8.5**
  - [x] 22.4 Write property test for unauthenticated `/auth/me` leaking no profile
    - **Property 26: Unauthenticated `/auth/me` leaks no profile**
    - **Validates: Requirements 8.3**

- [x] 23. Wire the AuthModule and register global providers
  - [x] 23.1 Assemble `AuthModule` and register globals
    - In `apps/api/src/modules/auth/auth.module.ts`, register controller, services (`AuthService`, `TokenService`, `RefreshTokenService`, `PasswordHasher`, `JwtStrategy`), `PrismaService`, and bind the `CAPTCHA_VERIFIER`/`MAILER`/`RATE_LIMITER` tokens (config-driven, default fakes); register `JwtModule`.
    - In `app.module.ts`/`main.ts`, register the global `ValidationPipe`, `AllExceptionsFilter`, and `SnakeCaseInterceptor`.
    - _Requirements: 12.1, 12.3, 10.1_

- [x] 24. Write end-to-end integration tests
  - [x] 24.1 Write Nest e2e tests for all endpoints
    - Using `@nestjs/testing` + supertest against a test PostgreSQL, cover each endpoint's HTTP status, headers (retry-after on 429), and snake_case bodies; verify guard ordering (`JwtAuthGuard` then `EmailVerifiedGuard`) and env-validation startup reporting all offenders.
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.2, 10.6, 12.3_
  - [x] 24.2 Write timing-sensitive assertions
    - Assert forgot-password timing difference within 500 ms between existing and non-existing well-formed emails, and latency bounds for `/auth/logout`, `/auth/forgot-password`, `/auth/me`.
    - _Requirements: 4.1, 6.1, 6.5, 8.1_

- [x] 25. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP, though the module is security-critical and the property tests are strongly recommended.
- Each task references specific requirement sub-clauses for traceability; property-test tasks additionally cite the design property number and its validated requirements.
- Property-based tests use `fast-check` at a minimum of 100 iterations, one property per test, tagged `// Feature: auth, Property {number}: {property_text}`, with in-memory fakes for Prisma and the `CaptchaVerifier`/`Mailer`/`RateLimiter` ports.
- Provider selection for captcha, mail, and the rate-limiter backing is deferred; ports ship with in-memory/dev fakes and config-driven binding stubs until concrete providers are approved.
- All 32 correctness properties from the design are covered: 1–4 (signup), 5–7 (login), 8–12 (refresh/validation), 13–15 (logout), 16–18 (verify/gating), 19–20 (forgot), 21–23 (reset), 24–26 (me), 27 (rate limit), 28–30 (tokens/tenant), 31–32 (envelope/serialization).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "5.1"] },
    { "id": 2, "tasks": ["3.2", "4.1", "4.2", "4.4", "5.2", "6.1"] },
    { "id": 3, "tasks": ["4.3", "4.5", "6.2", "7.1", "8.1", "14.1"] },
    { "id": 4, "tasks": ["7.2", "8.2", "8.3", "10.1", "11.1", "12.1", "14.2", "14.3", "14.4", "14.5", "14.6", "14.7"] },
    { "id": 5, "tasks": ["10.2", "10.3", "10.4", "10.5", "11.2", "11.3", "12.2"] },
    { "id": 6, "tasks": ["11.4", "11.5", "11.6", "15.1", "16.1", "19.1", "20.1", "21.1", "22.1"] },
    { "id": 7, "tasks": ["15.2", "15.3", "15.4", "16.2", "16.3", "17.1", "18.1", "19.2", "20.2", "21.2", "21.3", "22.2", "22.3", "22.4"] },
    { "id": 8, "tasks": ["18.2", "18.3", "18.4", "23.1"] },
    { "id": 9, "tasks": ["24.1", "24.2"] }
  ]
}
```
