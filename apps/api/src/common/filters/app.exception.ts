import { HttpStatus } from '@nestjs/common';
import type { ErrorCode, ErrorDetail } from '@avyo/types';

/**
 * Canonical mapping from an allowed {@link ErrorCode} to its HTTP status, per
 * the design's "Error Handling" section. This is the single source of truth
 * used by both {@link AppException} and the global exception filter.
 */
export const ERROR_CODE_STATUS: Readonly<Record<ErrorCode, HttpStatus>> = {
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST, // 400
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED, // 401
  FORBIDDEN: HttpStatus.FORBIDDEN, // 403
  EMAIL_NOT_VERIFIED: HttpStatus.FORBIDDEN, // 403
  NOT_FOUND: HttpStatus.NOT_FOUND, // 404
  CONFLICT: HttpStatus.CONFLICT, // 409
  UNPROCESSABLE: HttpStatus.UNPROCESSABLE_ENTITY, // 422
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS, // 429
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR, // 500
} as const;

/**
 * Base application exception. Every deliberately-thrown domain error carries an
 * explicit {@link ErrorCode} from the allowed set, the HTTP status derived from
 * {@link ERROR_CODE_STATUS}, a client-safe message, and optional field-level
 * `details`. The global exception filter renders these directly into the error
 * envelope without any leakage of internal state.
 */
export class AppException extends Error {
  /** The allowed error code carried by this exception (Req 12.1, 12.2). */
  readonly code: ErrorCode;

  /** The HTTP status derived from {@link code}. */
  readonly status: HttpStatus;

  /** Field-level details; empty when there is no field-level detail (Req 12.5). */
  readonly details: ErrorDetail[];

  constructor(code: ErrorCode, message: string, details: ErrorDetail[] = []) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = ERROR_CODE_STATUS[code];
    this.details = details;
    // Restore prototype chain for correct `instanceof` across transpile targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 — DTO/field validation failure or captcha failure. */
export class ValidationException extends AppException {
  constructor(message = 'Validation failed', details: ErrorDetail[] = []) {
    super('VALIDATION_ERROR', message, details);
  }
}

/** 401 — bad credentials or missing/invalid/expired/revoked/reused token. */
export class UnauthenticatedException extends AppException {
  constructor(message = 'Authentication required') {
    super('UNAUTHENTICATED', message);
  }
}

/** 403 — authenticated but not permitted. */
export class ForbiddenException extends AppException {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message);
  }
}

/** 403 — business route accessed by an unverified user. */
export class EmailNotVerifiedException extends AppException {
  constructor(message = 'Email address is not verified') {
    super('EMAIL_NOT_VERIFIED', message);
  }
}

/** 404 — resource of another tenant or not found. */
export class NotFoundException extends AppException {
  constructor(message = 'Resource not found') {
    super('NOT_FOUND', message);
  }
}

/** 409 — duplicate email on signup. */
export class ConflictException extends AppException {
  constructor(message = 'Resource already exists') {
    super('CONFLICT', message);
  }
}

/** 422 — expired/unknown/used verification or reset token. */
export class UnprocessableException extends AppException {
  constructor(message = 'Unprocessable request') {
    super('UNPROCESSABLE', message);
  }
}

/** 429 — rate limit exceeded. Carries an optional retry-after detail. */
export class RateLimitedException extends AppException {
  constructor(message = 'Too many requests', details: ErrorDetail[] = []) {
    super('RATE_LIMITED', message, details);
  }
}
