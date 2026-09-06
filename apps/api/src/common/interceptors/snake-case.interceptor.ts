import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Converts a single object key to `snake_case`.
 *
 * Handles the common casings encountered in JS object keys:
 * - camelCase / PascalCase: `emailVerifiedAt` -> `email_verified_at`
 * - acronym runs: `userID` -> `user_id`, `HTTPStatus` -> `http_status`
 * - already snake_case keys are preserved unchanged
 * - kebab-case and spaces collapse into underscores
 */
export function toSnakeCase(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .toLowerCase();
}

/**
 * Recursively converts the keys of a value to `snake_case`.
 *
 * Only plain-object keys are transformed. Values are never mutated:
 * - arrays keep their order and each element is converted recursively
 * - `Date` instances are returned as-is (never treated as plain objects)
 * - `null`, `undefined`, and primitives are returned unchanged
 */
export function convertKeysToSnakeCase(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => convertKeysToSnakeCase(item));
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[toSnakeCase(key)] = convertKeysToSnakeCase(val);
    }
    return result;
  }

  return value;
}

/**
 * Determines whether a value is a plain object whose keys should be converted.
 * Excludes `null`, arrays, `Date`, and other non-plain objects (e.g. Buffer,
 * Map, class instances backed by exotic prototypes) so their values are
 * preserved verbatim.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (value instanceof Date) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

/**
 * Global interceptor that serializes all success response bodies to
 * `snake_case`, including nested object keys (Req 12.3).
 *
 * Response DTOs are already defined in `snake_case`, so this interceptor acts
 * as a safety net that guarantees the API contract regardless of the shape a
 * controller returns.
 */
@Injectable()
export class SnakeCaseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((body) => convertKeysToSnakeCase(body)));
  }
}
