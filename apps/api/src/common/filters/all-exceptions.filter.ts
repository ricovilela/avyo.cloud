import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { ErrorCode, ErrorDetail, ErrorEnvelope } from '@avyo/types';
import { AppException } from './app.exception';

/**
 * Minimal structural type for the HTTP response object used by the filter.
 * Avoids a hard dependency on the `express` type declarations while remaining
 * compatible with the Express adapter's response (`res.status().json()`).
 */
interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  json(body: unknown): unknown;
}

/** Client-safe message used for any unmapped/uncaught error (Req 12.6). */
const GENERIC_INTERNAL_MESSAGE = 'Internal server error';

/**
 * Maps a built-in Nest {@link HttpException} status to an allowed
 * {@link ErrorCode}. Anything not listed collapses to `INTERNAL` (Req 12.6).
 */
function statusToErrorCode(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_ERROR';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHENTICATED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'UNPROCESSABLE';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL';
  }
}

/** Converts an identifier to snake_case (defensive; DTO fields already are). */
function toSnakeCase(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s.-]+/g, '_')
    .toLowerCase();
}

/**
 * Extracts one `{ field, message }` detail per invalid field from a Nest
 * `ValidationPipe` `BadRequestException`. The default pipe produces a response
 * whose `message` is a string array (one message per failed constraint), each
 * conventionally prefixed with the offending property name. Entries are grouped
 * so there is exactly one detail per invalid field (Req 12.4). Returns `null`
 * when the exception does not look like a validation failure.
 */
function extractValidationDetails(response: unknown): ErrorDetail[] | null {
  if (typeof response !== 'object' || response === null) {
    return null;
  }
  const message = (response as { message?: unknown }).message;
  if (!Array.isArray(message) || message.length === 0) {
    return null;
  }
  if (!message.every((m): m is string => typeof m === 'string')) {
    return null;
  }

  const byField = new Map<string, string>();
  for (const raw of message as string[]) {
    const trimmed = raw.trim();
    const field = toSnakeCase(trimmed.split(/\s+/)[0] ?? 'body');
    if (!byField.has(field)) {
      byField.set(field, trimmed);
    }
  }

  return Array.from(byField, ([field, msg]) => ({ field, message: msg }));
}

/**
 * Global exception filter that renders every thrown error as the standard
 * {@link ErrorEnvelope} (`{ error: { code, message, details } }`, Req 12.1).
 *
 * - {@link AppException}: uses its explicit code/status/details.
 * - Nest {@link HttpException} (including `ValidationPipe`'s
 *   `BadRequestException`): maps status → code; validation failures become
 *   `VALIDATION_ERROR` with one snake_case `{ field, message }` per invalid
 *   field (Req 12.4).
 * - Anything else: `500 INTERNAL` with a generic message and `details: []`,
 *   never leaking stack traces or internal messages (Req 12.5, 12.6).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<HttpResponseLike>();

    const { status, envelope } = this.buildResponse(exception);
    res.status(status).json(envelope);
  }

  private buildResponse(exception: unknown): {
    status: number;
    envelope: ErrorEnvelope;
  } {
    if (exception instanceof AppException) {
      return {
        status: exception.status,
        envelope: {
          error: {
            code: exception.code,
            message: exception.message,
            details: exception.details,
          },
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = statusToErrorCode(status);

      // Unmapped HTTP statuses collapse to INTERNAL with a generic message.
      if (code === 'INTERNAL') {
        return this.internal();
      }

      const response = exception.getResponse();
      const details =
        code === 'VALIDATION_ERROR'
          ? (extractValidationDetails(response) ?? [])
          : [];

      return {
        status,
        envelope: {
          error: {
            code,
            message: exception.message,
            details,
          },
        },
      };
    }

    // Unknown/uncaught error: never leak internals.
    return this.internal();
  }

  private internal(): { status: number; envelope: ErrorEnvelope } {
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      envelope: {
        error: {
          code: 'INTERNAL',
          message: GENERIC_INTERNAL_MESSAGE,
          details: [],
        },
      },
    };
  }
}
