# Requirements Document

## Introduction

The Authentication module (`auth`) is the foundational module of the Avyo MVP, a multi-tenant SaaS for bird breeding management. It provides account creation, credential-based authentication with JWT (HS256) access tokens and rotating refresh tokens, email verification, password reset, session revocation, and delivery of the authenticated user's profile plus a dynamic navigation menu.

This module establishes the multi-tenant isolation foundation (`user_id` scoping) that every other MVP module depends on, and it enforces the security controls defined in the canonical source of truth (`mvp-project.md`, sections 3, 6, 7, and 11): captcha, rate limiting, anti-enumeration, device fingerprinting, non-sequential (UUID) identifiers, and email-verification gating of business routes.

The module lives at `apps/api/src/modules/auth/` (NestJS 11 + `@nestjs/jwt` + Passport, Prisma 6, PostgreSQL 17). All API request and response bodies use `snake_case`, and shared contract types live in `packages/types` (`@avyo/types`).

## Glossary

- **Auth_System**: The authentication module (`apps/api/src/modules/auth/`) that exposes the `/auth/*` endpoints and enforces authentication rules.
- **User**: A registered account holder, persisted in the `user` table with a UUID primary key, unique `email`, `password_hash`, `email_verified_at`, and `plan` (default `ctrlsale`).
- **Access_Token**: A short-lived JWT signed with HS256 using a symmetric secret from the environment, carrying the authenticated User identity. Default lifetime is 86400 seconds (24 hours).
- **Refresh_Token**: A persisted, revocable credential used to obtain a new Access_Token. Subject to rotation on each use.
- **Refresh_Token_Chain**: The lineage of Refresh_Tokens produced by successive rotations originating from a single login.
- **Email_Verification_Token**: A single-use token delivered by email that confirms ownership of a User's email address.
- **Password_Reset_Token**: A single-use token delivered by email that authorizes a password change.
- **Captcha_Verifier**: The component that validates the `captcha0` and `captcha1` challenge fields against the configured captcha provider.
- **Rate_Limiter**: The component that throttles requests to `/auth/login`, `/auth/signup`, and `/auth/forgot-password` by client IP and by email.
- **Device_Fingerprint**: The `device` object captured at login, containing `user_agent`, `os`, and `browser`, recorded for auditing.
- **Dynamic_Menu**: The list of navigation entries (`key`, `label`, `route`, `icon`) returned with the User profile from `/auth/me`.
- **Error_Envelope**: The standard error response body `{ "error": { "code", "message", "details": [] } }`.
- **Business_Route**: Any authenticated non-`auth` endpoint of the Avyo API (for example `/bird`, `/species`, `/calendar`).
- **Verified_User**: A User whose `email_verified_at` value is a non-null timestamp.
- **Unverified_User**: A User whose `email_verified_at` value is null.

## Requirements

### Requirement 1: Account Signup

**User Story:** As a prospective breeder, I want to create an account with my name, email, and password, so that I can start using Avyo.

#### Acceptance Criteria

1. WHEN a signup request is received with a `name` of 1 to 255 characters, an `email` of 3 to 254 characters in RFC 5322 address format, a `password` of 8 to 128 characters, and `captcha0` and `captcha1` values that pass Captcha_Verifier validation, THE Auth_System SHALL create a User with `email_verified_at` set to null and `plan` set to `ctrlsale`.
2. WHEN a User is created, THE Auth_System SHALL respond with HTTP 201 and a body containing the User `id` as a UUID, the User `email`, and `email_verified_at` set to null.
3. WHEN a User is created, THE Auth_System SHALL store the `password` as a `password_hash` using a one-way hashing algorithm and SHALL exclude `password` and `password_hash` from the response body.
4. WHEN a User is created, THE Auth_System SHALL trigger delivery of an email containing an Email_Verification_Token to the User email address within 60 seconds.
5. IF a signup request contains an `email` that, compared case-insensitively, already belongs to an existing User, THEN THE Auth_System SHALL respond with HTTP 409 and an Error_Envelope with code `CONFLICT` without creating a new User.
6. IF a signup request contains a `name` outside 1 to 255 characters, an `email` that is absent, exceeds 254 characters, or does not match RFC 5322 address format, or a `password` outside 8 to 128 characters, THEN THE Auth_System SHALL respond with HTTP 400 and an Error_Envelope with code `VALIDATION_ERROR` without persisting any User record.
7. IF a signup request fails Captcha_Verifier validation on `captcha0` or `captcha1`, THEN THE Auth_System SHALL respond with HTTP 400 and an Error_Envelope with code `VALIDATION_ERROR` without persisting any User record.
8. IF User creation fails after validation succeeds, THEN THE Auth_System SHALL respond with HTTP 500 and an Error_Envelope with code `INTERNAL` without persisting a partial User record.
9. IF more than 10 signup requests originate from the same client IP address within any 60-second window, THEN THE Auth_System SHALL respond with HTTP 429 and an Error_Envelope with code `RATE_LIMITED` without persisting any User record.

### Requirement 2: Login and Token Issuance

**User Story:** As a registered user, I want to log in with my credentials, so that I receive tokens to access the application.

#### Acceptance Criteria

1. WHEN a login request is received with an `email` and `password` that match an existing User, `captcha0` and `captcha1` values that pass Captcha_Verifier validation, and a `device` object containing non-empty string `user_agent`, `os`, and `browser` fields, THE Auth_System SHALL respond with HTTP 200 and a body containing `access_token`, `refresh_token`, `token_type` set to `bearer`, and `expires_in` set to 86400.
2. WHEN a login request succeeds, THE Auth_System SHALL issue an Access_Token signed with HS256 using the configured symmetric secret and valid for 86400 seconds from issuance.
3. WHEN a login request succeeds, THE Auth_System SHALL persist the issued Refresh_Token associated with the authenticated User.
4. WHEN a login request succeeds, THE Auth_System SHALL record the Device_Fingerprint values `user_agent`, `os`, and `browser` for auditing.
5. IF a login request contains an `email` and `password` combination that does not match an existing User, THEN THE Auth_System SHALL respond with HTTP 401 and an Error_Envelope with code `UNAUTHENTICATED` and SHALL NOT issue or persist any tokens.
6. IF a login request fails Captcha_Verifier validation on `captcha0` or `captcha1`, THEN THE Auth_System SHALL respond with HTTP 400 and an Error_Envelope with code `VALIDATION_ERROR`.
7. IF a login request omits the `email`, `password`, or `device` field, or provides a `device` object missing any of the `user_agent`, `os`, or `browser` fields or containing an empty string for any of them, THEN THE Auth_System SHALL respond with HTTP 400 and an Error_Envelope with code `VALIDATION_ERROR`.
8. WHEN an Unverified_User submits a login request satisfying criterion 1, THE Auth_System SHALL respond with HTTP 200 and issue tokens with the same body structure as criterion 1.

### Requirement 3: Refresh Token Rotation

**User Story:** As a logged-in user, I want my access token to renew silently, so that I stay signed in without re-entering credentials.

#### Acceptance Criteria

1. WHEN a refresh request is received with a `refresh_token` that is a non-empty string, currently valid, and not revoked, THE Auth_System SHALL respond with HTTP 200 and a snake_case body containing a newly generated `access_token`, a newly generated `refresh_token` (both string values that differ from the presented `refresh_token`), `token_type` set to `bearer`, and `expires_in` set to `86400` (seconds).
2. WHEN a refresh request succeeds, THE Auth_System SHALL, before responding, revoke the presented Refresh_Token and persist the newly issued Refresh_Token as the successor in the same Refresh_Token_Chain, such that the presented Refresh_Token is no longer valid for any subsequent request.
3. IF a refresh request presents a Refresh_Token that has already been rotated (its successor exists in the Refresh_Token_Chain), THEN THE Auth_System SHALL revoke every Refresh_Token in that Refresh_Token_Chain, issue no new `access_token` or `refresh_token`, and respond with HTTP 401 and a snake_case Error_Envelope with code `UNAUTHENTICATED`.
4. IF a refresh request presents a `refresh_token` that is a non-empty string but is revoked, expired, or not found in any Refresh_Token_Chain, THEN THE Auth_System SHALL issue no new `access_token` or `refresh_token`, leave all other Refresh_Token_Chains unchanged, and respond with HTTP 401 and a snake_case Error_Envelope with code `UNAUTHENTICATED`.
5. IF a refresh request omits the `refresh_token` field, or provides it as null, an empty string, a string consisting only of whitespace, or a non-string value, THEN THE Auth_System SHALL issue no new tokens and respond with HTTP 400 and a snake_case Error_Envelope with code `VALIDATION_ERROR`.

### Requirement 4: Logout and Session Revocation

**User Story:** As a logged-in user, I want to log out, so that my current session can no longer be refreshed.

#### Acceptance Criteria

1. WHEN a logout request is received with a valid Bearer Access_Token, THE Auth_System SHALL revoke the Refresh_Token bound to that Access_Token's session, respond with HTTP 204 and an empty response body, and complete the response within 1000 milliseconds under nominal load.
2. IF a logout request is received with no Authorization header, with an Authorization header that is not of the `Bearer` scheme, or with an expired, malformed, or otherwise invalid Access_Token, THEN THE Auth_System SHALL respond with HTTP 401 and a snake_case Error_Envelope whose `code` field equals `UNAUTHENTICATED`, and SHALL NOT revoke any Refresh_Token.
3. WHEN a Refresh_Token has been revoked by logout, THE Auth_System SHALL reject any subsequent refresh request presenting that Refresh_Token with HTTP 401 and a snake_case Error_Envelope whose `code` field equals `UNAUTHENTICATED`.
4. WHEN a logout request is received with a valid Bearer Access_Token whose session Refresh_Token has already been revoked, THE Auth_System SHALL respond with HTTP 204 and an empty response body without changing any additional session state.
5. WHEN a logout request revokes the Refresh_Token of the current session, THE Auth_System SHALL leave the Refresh_Tokens of all other active sessions of the same user unchanged.

### Requirement 5: Email Verification

**User Story:** As a new user, I want to confirm my email address, so that I can gain full access to the application.

#### Acceptance Criteria

1. WHEN a verify-email request is received with a `token` that matches an unused, unexpired Email_Verification_Token, THE Auth_System SHALL set the associated User `email_verified_at` to the current UTC timestamp and respond with HTTP 204 and an empty response body.
2. IF a verify-email request presents a `token` value that is unknown, already used, or older than its 86400-second validity period (expired), THEN THE Auth_System SHALL leave the associated User `email_verified_at` unchanged and respond with HTTP 422 and an Error_Envelope with code `UNPROCESSABLE`.
3. IF a verify-email request omits the `token` field, or provides a `token` that is null, empty, non-string, or exceeds 512 characters, THEN THE Auth_System SHALL respond with HTTP 400 and an Error_Envelope with code `VALIDATION_ERROR`.
4. WHILE a User is an Unverified_User, THE Auth_System SHALL reject each Business_Route request authenticated by that User without applying any state change and respond with HTTP 403 and an Error_Envelope with code `EMAIL_NOT_VERIFIED`.
5. WHEN a User becomes a Verified_User, THE Auth_System SHALL allow that User to access Business_Routes subject to remaining authorization rules.

### Requirement 6: Forgot Password

**User Story:** As a user who forgot my password, I want to request a reset link, so that I can regain access to my account.

#### Acceptance Criteria

1. WHEN a forgot-password request is received with an `email` that is a non-empty string of at most 254 characters conforming to the standard `local-part@domain` email format and that belongs to an existing User, THE Auth_System SHALL trigger delivery of an email containing a single-use Password_Reset_Token to that email address and SHALL respond with HTTP 204 and an empty body within 2000 milliseconds.
2. WHEN a forgot-password request is received with a well-formed `email` that does not belong to any User, THE Auth_System SHALL respond with HTTP 204 and an empty body within 2000 milliseconds without sending an email.
3. IF a forgot-password request omits the `email` field, provides an `email` that is empty, exceeds 254 characters, or does not conform to the standard `local-part@domain` email format, THEN THE Auth_System SHALL respond with HTTP 400 and a snake_case Error_Envelope whose `code` field equals `VALIDATION_ERROR` and SHALL NOT trigger any email delivery.
4. WHEN forgot-password requests are received for an existing `email` and for a non-existing well-formed `email`, THE Auth_System SHALL return responses that are identical in HTTP status code (204) and response body (empty), so that account existence is not disclosed.
5. WHILE processing forgot-password requests for existing and non-existing well-formed email addresses, THE Auth_System SHALL keep the difference between their response times within 500 milliseconds, so that account existence cannot be inferred from response timing.

### Requirement 7: Reset Password

**User Story:** As a user with a reset link, I want to set a new password, so that I can log in again.

#### Acceptance Criteria

1. WHEN a reset-password request is received with a Password_Reset_Token that is known, unexpired, and unused, and a `password` between 8 and 128 characters inclusive, THE Auth_System SHALL update the User `password_hash` to the hash of the new `password` and respond with HTTP 204 and an empty response body.
2. WHEN a reset-password request succeeds, THE Auth_System SHALL mark the presented Password_Reset_Token as used such that any subsequent reset-password request presenting the same token is rejected per criterion 4.
3. WHEN a reset-password request succeeds, THE Auth_System SHALL revoke all active Refresh_Tokens belonging to the User such that each revoked Refresh_Token can no longer be exchanged for a new access token.
4. IF a reset-password request presents a Password_Reset_Token that is expired, unknown, or already used, THEN THE Auth_System SHALL leave the User `password_hash` unchanged and respond with HTTP 422 and a snake_case Error_Envelope with code `UNPROCESSABLE`.
5. IF a reset-password request omits the `token` field, omits the `password` field, or provides a `password` shorter than 8 characters or longer than 128 characters, THEN THE Auth_System SHALL leave the User `password_hash` unchanged and respond with HTTP 400 and a snake_case Error_Envelope with code `VALIDATION_ERROR`.

### Requirement 8: Profile and Dynamic Menu

**User Story:** As a logged-in user, I want to retrieve my profile and navigation menu, so that the frontend can render my authorized workspace.

#### Acceptance Criteria

1. WHEN a `/auth/me` request is received with a valid Bearer Access_Token, THE Auth_System SHALL respond within 2000 milliseconds with HTTP 200 and a snake_case JSON body containing a `user` object with non-null `id`, `name`, `email`, and `plan` fields, an `email_verified_at` field, and a `menu` array.
2. THE Auth_System SHALL populate each Dynamic_Menu entry with non-empty string fields `key`, `label`, `route`, and `icon`, and SHALL return the menu entries in the same order across repeated requests for the same user.
3. IF a `/auth/me` request is received without a Bearer Access_Token or with an invalid or expired Access_Token, THEN THE Auth_System SHALL respond with HTTP 401 and an Error_Envelope whose `code` field equals `UNAUTHENTICATED`, and SHALL NOT include a `user` object or a `menu` array in the response body.
4. WHEN a `/auth/me` request is authenticated by an Unverified_User, THE Auth_System SHALL respond with HTTP 200 and set `user.email_verified_at` to null.
5. WHEN a `/auth/me` request is authenticated by a user whose email has been verified, THE Auth_System SHALL set `user.email_verified_at` to the ISO 8601 timestamp at which verification occurred.
6. IF the authenticated user has no plan assigned, THEN THE Auth_System SHALL set `user.plan` to `ctrlsale`.

### Requirement 9: Rate Limiting

**User Story:** As the platform operator, I want authentication endpoints throttled, so that brute-force and automated abuse are mitigated.

#### Acceptance Criteria

1. WHERE a request targets `/auth/login`, `/auth/signup`, or `/auth/forgot-password`, THE Rate_Limiter SHALL independently count requests per endpoint by client IP address and by the request email address, matching email addresses case-insensitively after trimming surrounding whitespace, within a configurable rolling time window (default 60 seconds).
2. IF the number of requests from a single client IP address to a throttled endpoint reaches or exceeds the configurable per-IP limit (default 10 requests) within the configured rolling time window, THEN THE Auth_System SHALL reject the request without processing it and respond with HTTP 429 and a snake_case Error_Envelope with code `RATE_LIMITED`.
3. IF the number of requests targeting a single email address on a throttled endpoint reaches or exceeds the configurable per-email limit (default 5 requests) within the configured rolling time window, THEN THE Auth_System SHALL reject the request without processing it and respond with HTTP 429 and a snake_case Error_Envelope with code `RATE_LIMITED`.
4. WHEN THE Auth_System responds with code `RATE_LIMITED`, THE Auth_System SHALL include a retry-after indication expressing the number of whole seconds the client must wait before further requests to that endpoint are accepted.
5. WHILE the per-IP and per-email request counts for an endpoint are both below their configured limits within the configured rolling time window, THE Auth_System SHALL forward the request for normal processing.

### Requirement 10: Token Security and Configuration

**User Story:** As the platform operator, I want signing secrets and token lifetimes to be configurable via environment, so that secrets can be rotated without code changes.

#### Acceptance Criteria

1. THE Auth_System SHALL sign every Access_Token with the HS256 algorithm using the symmetric secret provided by the `JWT_SECRET` environment variable.
2. WHEN the `JWT_EXPIRES_IN` environment variable is absent, empty, or whitespace-only, THE Auth_System SHALL set the Access_Token lifetime to 86400 seconds; otherwise THE Auth_System SHALL set the Access_Token lifetime to the value of `JWT_EXPIRES_IN`.
3. WHEN the Auth_System issues a Refresh_Token, THE Auth_System SHALL sign or derive it using the secret provided by the `REFRESH_SECRET` environment variable and set its lifetime to the value of the `REFRESH_EXPIRES_IN` environment variable, interpreted in seconds or as a duration string.
4. IF a request presents an Access_Token whose signature does not validate against the configured secret, THEN THE Auth_System SHALL respond with HTTP 401 and a snake_case Error_Envelope whose `code` field equals `UNAUTHENTICATED` and SHALL NOT establish an authenticated session.
5. IF a request presents an Access_Token whose expiry has passed, THEN THE Auth_System SHALL respond with HTTP 401 and a snake_case Error_Envelope whose `code` field equals `UNAUTHENTICATED` and SHALL NOT establish an authenticated session.
6. IF any of the environment variables `JWT_SECRET` or `REFRESH_SECRET` is absent, empty, or whitespace-only at startup, THEN THE Auth_System SHALL fail startup and report every missing variable.

### Requirement 11: Multi-Tenant Identity Foundation

**User Story:** As the platform operator, I want each authenticated request bound to a single tenant identity, so that other modules can isolate data by user.

#### Acceptance Criteria

1. WHEN the Auth_System successfully validates a Bearer Access_Token on a request, THE Auth_System SHALL bind the authenticated User `id` from that token to the request as the single tenant identifier and make it available to downstream request handlers.
2. IF a request presents a missing, malformed, expired, or otherwise invalid Bearer Access_Token, THEN THE Auth_System SHALL reject the request without binding any tenant identifier and SHALL return an authentication error response indicating the token is not valid.
3. THE Auth_System SHALL assign a version-4 UUID as the primary key of every User at creation, and each assigned UUID SHALL be unique across all Users.
4. WHEN the Auth_System resolves the tenant identifier for a request, THE Auth_System SHALL derive it solely from the validated Access_Token and SHALL ignore any tenant identifier supplied in the request body, query parameters, or headers, such that the effective tenant identity always equals the User `id` from the token regardless of any conflicting supplied value.

### Requirement 12: Error Envelope and Serialization Contract

**User Story:** As a frontend developer, I want consistent error and field formats, so that I can build reliable client handling.

#### Acceptance Criteria

1. WHEN the Auth_System returns any error response, THE Auth_System SHALL format the body as an Error_Envelope containing exactly the keys `error.code`, `error.message` (a string of 1 to 500 characters), and `error.details` (an array).
2. THE Auth_System SHALL restrict `error.code` values to the set `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `EMAIL_NOT_VERIFIED`, `NOT_FOUND`, `CONFLICT`, `UNPROCESSABLE`, `RATE_LIMITED`, and `INTERNAL`.
3. THE Auth_System SHALL serialize all request and response body field names, including nested field names, in `snake_case`.
4. WHEN a validation error includes field-level detail, THE Auth_System SHALL populate `error.details` with one entry per invalid field, each entry containing exactly a `field` name (a snake_case string) and a `message` (a string of 1 to 500 characters).
5. WHEN an error response has no field-level detail, THE Auth_System SHALL set `error.details` to an empty array.
6. IF the Auth_System encounters an error that does not map to a specific Error_Envelope code, THEN THE Auth_System SHALL respond with HTTP 500 and an Error_Envelope with code `INTERNAL`.

## Open Decisions

The following decisions are recorded from `mvp-project.md` section 11.4. They do not block requirements approval but MUST be resolved before implementation of the affected areas:

- **Captcha provider**: The specific provider for Captcha_Verifier (hCaptcha, reCAPTCHA, or Cloudflare Turnstile) is not yet chosen. This affects the semantics and validation of the `captcha0` and `captcha1` fields and the `CAPTCHA_*` environment variables.
- **Transactional email provider**: The provider for verification and reset emails (SMTP, Resend, or SES) is not yet chosen. This affects Email_Verification_Token and Password_Reset_Token delivery and the `MAIL_*` environment variables.
- **Rate limit thresholds**: The concrete request limits and time windows for the Rate_Limiter (per IP and per email) are not yet specified and MUST be set before implementation.
- **Token lifetime defaults**: The default Refresh_Token lifetime (`REFRESH_EXPIRES_IN`) value is not fixed; only the Access_Token default (86400 seconds) is defined.
