import type { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Controller, Get } from '@nestjs/common';
import fc from 'fast-check';

import type { Config } from '../../config/env.validation';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtStrategy } from './jwt.strategy';

/**
 * Feature: auth, Property 30: Tenant identity always comes from the token
 *
 * Validates: Requirements 11.1, 11.4
 *
 * For any authenticated request, the resolved tenant identifier equals the
 * `sub` of the validated Access_Token, regardless of any conflicting `user_id`
 * supplied in the body, query, or headers. `JwtStrategy.validate` is the
 * authoritative source of tenant identity: it reads only `sub` and ignores
 * every other token claim (11.1, 11.4). The `@CurrentUser()` decorator merely
 * returns `request.user.user_id`, which the guard binds from `validate()`, so
 * conflicting body/query/header `user_id` values can never influence it.
 */

/** A minimal valid {@link Config} for constructing the strategy. */
const CONFIG: Config = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/avyo',
  JWT_SECRET: 'test-secret-value-that-is-long-enough',
  JWT_EXPIRES_IN: '86400',
  REFRESH_SECRET: 'test-refresh-secret-value',
  REFRESH_EXPIRES_IN: '604800',
  PORT: 3000,
};

/**
 * Resolve the {@link CurrentUser} param decorator's factory so it can be
 * invoked directly with a fabricated {@link ExecutionContext}.
 *
 * `createParamDecorator` stores the factory in route-args metadata under a
 * generated key; we register the decorator on a throwaway handler param and
 * read that factory back out.
 */
function extractCurrentUserFactory(): (
  data: unknown,
  ctx: ExecutionContext,
) => string {
  class Probe {
    handler(@CurrentUser() _userId: string): void {
      void _userId;
    }
  }

  const metadata = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    Probe,
    'handler',
  ) as Record<string, { factory: (data: unknown, ctx: ExecutionContext) => string }>;

  const entry = Object.values(metadata)[0];
  if (entry === undefined) {
    throw new Error('CurrentUser factory metadata not found');
  }
  return entry.factory;
}

function makeContext(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T>() => request as T,
    }),
  } as unknown as ExecutionContext;
}

describe('JwtStrategy property: tenant identity always comes from the token (Property 30)', () => {
  it('resolves the principal solely from sub, ignoring conflicting user_id in body/query/headers and extra claims', () => {
    const strategy = new JwtStrategy(CONFIG);
    const currentUserFactory = extractCurrentUserFactory();

    // Arbitrary values used to attempt to override the token-derived identity.
    const conflictArb = fc.oneof(
      fc.uuid(),
      fc.string(),
      fc.integer(),
      fc.constant(undefined),
    );

    fc.assert(
      fc.property(
        fc.uuid(),
        conflictArb,
        conflictArb,
        conflictArb,
        conflictArb,
        fc.string(),
        (sub, bodyUserId, queryUserId, headerUserId, claimUserId, email) => {
          // The token payload may carry conflicting `user_id`/`email` claims;
          // only `sub` is authoritative (11.4).
          const payload = {
            sub,
            user_id: claimUserId,
            email,
          } as unknown as { sub: string };

          const principal = strategy.validate(payload);

          // Identity is derived solely from the token's `sub` (11.1).
          expect(principal.user_id).toBe(sub);

          // The guard binds request.user from validate(); the decorator then
          // returns request.user.user_id. Conflicting body/query/header values
          // must not change the resolved identity (11.4).
          const request = {
            user: principal,
            body: { user_id: bodyUserId },
            query: { user_id: queryUserId },
            headers: { 'x-user-id': headerUserId },
          };
          const resolved = currentUserFactory(undefined, makeContext(request));

          expect(resolved).toBe(sub);
        },
      ),
      { numRuns: 200 },
    );
  });
});
