import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';

import {
  RATE_LIMITER,
  type RateLimiter,
} from '../../modules/auth/ports/rate-limiter';
import { RateLimitedException } from '../filters/app.exception';

/**
 * Minimal structural type for the HTTP request fields the guard reads. Avoids a
 * hard dependency on the `express` type declarations while remaining compatible
 * with the Express adapter's request object.
 */
interface HttpRequestLike {
  /** Matched route path (e.g. `/auth/login`); present once routing resolved. */
  route?: { path?: unknown };
  /** Raw URL path, used as a fallback when `route.path` is unavailable. */
  originalUrl?: unknown;
  url?: unknown;
  /** Connection remote address, resolved by Express (`app.set('trust proxy')`). */
  ip?: unknown;
  /** Parsed request headers (lower-cased keys per Node's http server). */
  headers?: Record<string, unknown>;
  /** Parsed JSON body (available because the guard runs after body parsing). */
  body?: unknown;
}

/** Minimal structural type for the response object used to set headers. */
interface HttpResponseLike {
  header(name: string, value: string): unknown;
}

/**
 * Extracts the endpoint identifier the limiter counts against. Prefers the
 * matched route path so all requests to a route share one bucket regardless of
 * query strings; falls back to the URL path with any query/hash stripped.
 */
export function resolveEndpoint(request: HttpRequestLike): string {
  const routePath = request.route?.path;
  if (typeof routePath === 'string' && routePath.length > 0) {
    return routePath;
  }

  const rawUrl =
    (typeof request.originalUrl === 'string' && request.originalUrl) ||
    (typeof request.url === 'string' && request.url) ||
    '';
  // Strip query string / fragment so `/auth/login?x=1` shares one bucket.
  return rawUrl.split(/[?#]/)[0] ?? '';
}

/**
 * Resolves the client IP. Prefers the first hop of `X-Forwarded-For` (the
 * originating client when behind a trusted proxy), then falls back to the
 * connection address exposed as `request.ip`. Returns an empty string when no
 * source is available so the limiter still receives a stable key.
 */
export function resolveClientIp(request: HttpRequestLike): string {
  const forwardedFor = request.headers?.['x-forwarded-for'];
  const firstHop = firstForwardedHop(forwardedFor);
  if (firstHop !== null) {
    return firstHop;
  }

  return typeof request.ip === 'string' ? request.ip : '';
}

/** Returns the first, trimmed hop of an `X-Forwarded-For` value, or `null`. */
function firstForwardedHop(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return null;
  }
  const first = raw.split(',')[0]?.trim() ?? '';
  return first.length > 0 ? first : null;
}

/**
 * Extracts the request email for per-email counting. Returns the raw string
 * when a non-empty `email` is present in the body (the limiter normalizes it by
 * trimming and lower-casing), or `null` when absent/blank/non-string.
 */
export function resolveEmail(request: HttpRequestLike): string | null {
  const body = request.body;
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const email = (body as { email?: unknown }).email;
  if (typeof email !== 'string' || email.trim().length === 0) {
    return null;
  }
  return email;
}

/**
 * Guard that enforces per-endpoint rate limiting via the {@link RateLimiter}
 * port. It counts each request by client IP and by request email within the
 * rolling window and, when either limit is reached, short-circuits with
 * `429 RATE_LIMITED` **before** the controller runs (guards execute ahead of
 * the route handler by design).
 *
 * On rejection it surfaces the whole-second retry-after two ways (Req 9.4):
 * the standard `Retry-After` HTTP header and a `retry_after` entry in the
 * error envelope `details`, rendered by the global exception filter.
 *
 * Intended to be attached with `@UseGuards(RateLimitGuard)` on `/auth/login`,
 * `/auth/signup`, and `/auth/forgot-password` only — it is not registered
 * globally.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequestLike>();
    const response = http.getResponse<HttpResponseLike>();

    const endpoint = resolveEndpoint(request);
    const ip = resolveClientIp(request);
    const email = resolveEmail(request);

    const { allowed, retryAfterSeconds } = await this.limiter.hit(
      endpoint,
      ip,
      email,
    );

    if (allowed) {
      return true;
    }

    // Whole-second retry-after, surfaced as both a header and envelope detail.
    const retryAfter = String(Math.max(0, Math.ceil(retryAfterSeconds)));
    response.header('Retry-After', retryAfter);

    throw new RateLimitedException('Too many requests', [
      { field: 'retry_after', message: retryAfter },
    ]);
  }
}
