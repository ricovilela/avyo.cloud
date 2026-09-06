import type { ExecutionContext } from '@nestjs/common';
import fc from 'fast-check';

import type { RateLimitWindow } from '../../modules/auth/ports/rate-limiter';
import { InMemoryRateLimiter } from '../../modules/auth/ports/fakes/in-memory-rate-limiter';
import { RateLimitedException } from '../filters/app.exception';
import { RateLimitGuard } from './rate-limit.guard';

/**
 * Feature: auth, Property 27: Rate limiting triggers at configured thresholds
 * with retry-after
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5
 *
 * Drives the `RateLimitGuard` over a real `InMemoryRateLimiter` and replays a
 * sequence of requests to a single throttled endpoint. An independent oracle
 * counts allowed requests per IP and per normalized (trimmed, lower-cased)
 * email. The guard must allow a request exactly while both counts are below
 * their limits (9.1, 9.5) and short-circuit with `429 RATE_LIMITED` the moment
 * either limit is reached (9.2, 9.3), setting a whole-second `Retry-After`
 * header and `retry_after` detail (9.4) without counting the rejected request.
 */

const ENDPOINT = '/auth/login';

/** Records `Retry-After` header writes for post-hoc assertions. */
interface RecordingResponse {
  headers: Record<string, string>;
  header(name: string, value: string): void;
}

function makeResponse(): RecordingResponse {
  const headers: Record<string, string> = {};
  return {
    headers,
    header(name: string, value: string): void {
      headers[name] = value;
    },
  };
}

function makeContext(
  ip: string,
  email: string,
  response: RecordingResponse,
): ExecutionContext {
  const request = {
    route: { path: ENDPOINT },
    ip,
    headers: {},
    body: { email },
  };
  return {
    switchToHttp: () => ({
      getRequest: <T>() => request as T,
      getResponse: <T>() => response as T,
    }),
  } as unknown as ExecutionContext;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

describe('RateLimitGuard property: thresholds and retry-after (Property 27)', () => {
  it('allows while both counts are below limits and 429s at the threshold with whole-second retry-after', async () => {
    const windowArb: fc.Arbitrary<RateLimitWindow> = fc.record({
      // Large window so nothing ages out during a synchronous replay.
      windowSeconds: fc.integer({ min: 30, max: 3600 }),
      maxPerIp: fc.integer({ min: 1, max: 6 }),
      maxPerEmail: fc.integer({ min: 1, max: 6 }),
    });

    // Small pools so limits are actually reached; email variants exercise the
    // case-insensitive-after-trim matching (Req 9.1).
    const ipArb = fc.constantFrom('10.0.0.1', '10.0.0.2', '10.0.0.3');
    const emailArb = fc.constantFrom(
      'A@x.com',
      ' a@x.com ',
      'a@x.com',
      'B@x.com',
      'b@x.com ',
    );

    await fc.assert(
      fc.asyncProperty(
        windowArb,
        fc.array(fc.record({ ip: ipArb, email: emailArb }), {
          minLength: 1,
          maxLength: 40,
        }),
        async (window, requests) => {
          const limiter = new InMemoryRateLimiter(window);
          const guard = new RateLimitGuard(limiter);

          // Oracle: allowed counts per IP and per normalized email.
          const allowedByIp = new Map<string, number>();
          const allowedByEmail = new Map<string, number>();

          for (const req of requests) {
            const normEmail = normalizeEmail(req.email);
            const ipCount = allowedByIp.get(req.ip) ?? 0;
            const emailCount = allowedByEmail.get(normEmail) ?? 0;

            const shouldAllow =
              ipCount < window.maxPerIp && emailCount < window.maxPerEmail;

            const response = makeResponse();
            const ctx = makeContext(req.ip, req.email, response);

            if (shouldAllow) {
              await expect(guard.canActivate(ctx)).resolves.toBe(true);
              expect(response.headers['Retry-After']).toBeUndefined();
              allowedByIp.set(req.ip, ipCount + 1);
              allowedByEmail.set(normEmail, emailCount + 1);
            } else {
              let thrown: unknown;
              try {
                await guard.canActivate(ctx);
              } catch (err) {
                thrown = err;
              }

              // Rejected with the RATE_LIMITED envelope (Req 9.2, 9.3).
              expect(thrown).toBeInstanceOf(RateLimitedException);
              const exception = thrown as RateLimitedException;
              expect(exception.code).toBe('RATE_LIMITED');
              expect(exception.status).toBe(429);

              // Whole-second retry-after via header and detail (Req 9.4).
              const headerValue = response.headers['Retry-After'];
              expect(headerValue).toBeDefined();
              const parsed = Number(headerValue);
              expect(Number.isInteger(parsed)).toBe(true);
              expect(parsed).toBeGreaterThan(0);

              const detail = exception.details.find(
                (d) => d.field === 'retry_after',
              );
              expect(detail).toBeDefined();
              expect(detail?.message).toBe(headerValue);

              // Rejected request must NOT be counted (oracle unchanged).
            }
          }

          // Sanity: the oracle never exceeded either configured limit.
          for (const count of allowedByIp.values()) {
            expect(count).toBeLessThanOrEqual(window.maxPerIp);
          }
          for (const count of allowedByEmail.values()) {
            expect(count).toBeLessThanOrEqual(window.maxPerEmail);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
