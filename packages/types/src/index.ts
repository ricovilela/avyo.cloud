// @avyo/types — shared contract entry point.
//
// Single source of truth for the web ↔ api contract. Consumers import
// everything from the package root (no subpath imports required).
// All contract fields use snake_case to match the API body contract
// in `mvp-project.md` §6.

// --- Enums (real runtime values) -------------------------------------------

/** Bird sex. Exactly two members, per `mvp-project.md` §5.2. */
export enum sex {
  M = "M",
  F = "F",
}

/** Bird age group. Exactly two members, per `mvp-project.md` §5.2. */
export enum age_group {
  young = "young",
  adult = "adult",
}

// --- Pagination envelope ----------------------------------------------------

/** Pagination navigation links. `prev`/`next` are nullable. */
export interface Pagination_Links {
  first: string;
  last: string;
  prev: string | null;
  next: string | null;
}

/**
 * Pagination metadata. `from`/`to` are nullable; `current_page`,
 * `last_page`, `per_page`, and `total` are non-negative integers.
 */
export interface Pagination_Meta {
  current_page: number;
  from: number | null;
  last_page: number;
  per_page: number;
  to: number | null;
  total: number;
}

/**
 * Standard paginated response envelope. `data` is generic so each
 * endpoint keys it by entity (`{ "<entity>": [...] }`) per §6.
 */
export interface Pagination_Envelope<T> {
  data: T;
  links: Pagination_Links;
  meta: Pagination_Meta;
}

// --- Error envelope ---------------------------------------------------------

/** A single field-level error entry. */
export interface Error_Detail {
  field: string;
  message: string;
}

/** Error body: a string `code`, a string `message`, and optional `details`. */
export interface Error_Body {
  code: string;
  message: string;
  details?: Error_Detail[];
}

/** Standard error response envelope. */
export interface Error_Envelope {
  error: Error_Body;
}

// --- Auth contract: error codes --------------------------------------------

/**
 * The complete, allowed set of `error.code` values, per requirement 12.2.
 * Exported as a runtime `as const` tuple so callers can validate/iterate the
 * allowed codes; the `ErrorCode` union type below is derived from it.
 */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "EMAIL_NOT_VERIFIED",
  "NOT_FOUND",
  "CONFLICT",
  "UNPROCESSABLE",
  "RATE_LIMITED",
  "INTERNAL",
] as const;

/** Allowed `error.code` union, derived from {@link ERROR_CODES} (Req 12.2). */
export type ErrorCode = (typeof ERROR_CODES)[number];

/** A single field-level error entry (`field` is snake_case), per Req 12.4. */
export type ErrorDetail = Error_Detail;

/**
 * The standard error response body, per Req 12.1: exactly `error.code`
 * (from the allowed {@link ErrorCode} set), `error.message`, and
 * `error.details` (always an array — empty when there is no field detail,
 * Req 12.5). All body field names are snake_case (Req 12.3).
 */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details: ErrorDetail[];
  };
}

// --- Auth contract: request payloads ---------------------------------------

/** Device fingerprint captured at login (Req 2.1, 2.4). */
export interface DeviceFingerprint {
  user_agent: string;
  os: string;
  browser: string;
}

/** `POST /auth/signup` request body (Req 1.1). */
export interface SignupRequest {
  name: string;
  email: string;
  password: string;
  captcha0: string;
  captcha1: string;
}

/** `POST /auth/login` request body (Req 2.1). */
export interface LoginRequest {
  email: string;
  password: string;
  captcha0: string;
  captcha1: string;
  device: DeviceFingerprint;
}

/** `POST /auth/refresh` request body (Req 3.1). */
export interface RefreshRequest {
  refresh_token: string;
}

/** `POST /auth/verify-email` request body (Req 5.1). */
export interface VerifyEmailRequest {
  token: string;
}

/** `POST /auth/forgot-password` request body (Req 6.1). */
export interface ForgotPasswordRequest {
  email: string;
}

/** `POST /auth/reset-password` request body (Req 7.1). */
export interface ResetPasswordRequest {
  token: string;
  password: string;
}

// --- Auth contract: response shapes ----------------------------------------

/** `POST /auth/signup` success body (Req 1.2): never includes password data. */
export interface SignupResponse {
  id: string;
  email: string;
  email_verified_at: string | null;
}

/**
 * `POST /auth/login` success body (Req 2.1). `token_type` is always
 * `bearer` and `expires_in` is the access-token lifetime in seconds.
 */
export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  expires_in: number;
}

/**
 * `POST /auth/refresh` success body (Req 3.1). Identical in shape to
 * {@link LoginResponse}; aliased to keep a single source of truth.
 */
export type RefreshResponse = LoginResponse;

/** A single dynamic-menu navigation entry (Req 8.2). */
export interface MenuEntry {
  key: string;
  label: string;
  route: string;
  icon: string;
}

/** The authenticated user profile embedded in {@link AuthMeResponse} (Req 8.1). */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  plan: string;
  email_verified_at: string | null;
}

/** `POST /auth/me` success body (Req 8.1): profile plus dynamic menu. */
export interface AuthMeResponse {
  user: AuthUser;
  menu: MenuEntry[];
}
