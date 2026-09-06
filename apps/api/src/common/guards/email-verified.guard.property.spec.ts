import type { ExecutionContext } from '@nestjs/common';
import fc from 'fast-check';

import { EmailNotVerifiedException } from '../filters/app.exception';
import type { PrismaService } from '../prisma/prisma.service';
import { EmailVerifiedGuard } from './email-verified.guard';

/**
 * Feature: auth, Property 18: Unverified users are gated from business routes
 *
 * Validates: Requirements 5.4, 5.5
 *
 * Drives the `EmailVerifiedGuard` over a fake `PrismaService` whose
 * `user.findUnique` returns the generated user's `email_verified_at` (a Date
 * for a Verified_User, `null` for an Unverified_User) or `null` when the user
 * is absent. For any business-route request authenticated by an Unverified_User
 * — or a user that cannot be found — the guard must reject with
 * `403 EMAIL_NOT_VERIFIED` while performing no state change (only the read-only
 * `findUnique` is ever invoked); when `email_verified_at` is non-null the gate
 * must allow the request (resolve `true`).
 */

/** The mutating Prisma delegate methods that the guard must never invoke. */
const MUTATION_METHODS = [
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
] as const;

interface FakePrisma {
  service: PrismaService;
  findUniqueCalls: Array<{ where: { id: string } }>;
  mutationCalls: string[];
}

/**
 * Build a fake `PrismaService` exposing a recording `user` delegate. Only
 * `findUnique` returns data (the generated verification timestamp); every
 * mutation method records the fact that it was called so the test can assert
 * the guard never mutates state.
 */
function makeFakePrisma(emailVerifiedAt: Date | null, found: boolean): FakePrisma {
  const findUniqueCalls: Array<{ where: { id: string } }> = [];
  const mutationCalls: string[] = [];

  const user: Record<string, unknown> = {
    findUnique: (args: { where: { id: string }; select?: unknown }) => {
      findUniqueCalls.push({ where: args.where });
      return Promise.resolve(found ? { emailVerifiedAt } : null);
    },
  };

  for (const method of MUTATION_METHODS) {
    user[method] = (...args: unknown[]) => {
      mutationCalls.push(method);
      return Promise.resolve(args);
    };
  }

  const service = { user } as unknown as PrismaService;
  return { service, findUniqueCalls, mutationCalls };
}

function makeContext(userId: string | undefined): ExecutionContext {
  const request = { user: userId === undefined ? undefined : { user_id: userId } };
  return {
    switchToHttp: () => ({
      getRequest: <T>() => request as T,
    }),
  } as unknown as ExecutionContext;
}

describe('EmailVerifiedGuard property: business-route gating (Property 18)', () => {
  it('rejects unverified/absent users with 403 EMAIL_NOT_VERIFIED and no state change, allows verified users', async () => {
    // A user is one of three cases: verified (Date), unverified (null), or absent.
    const userArb = fc.oneof(
      fc.record({
        userId: fc.uuid(),
        kind: fc.constant('verified' as const),
        emailVerifiedAt: fc
          .date({ min: new Date('2000-01-01T00:00:00.000Z'), max: new Date('2100-01-01T00:00:00.000Z') })
          .filter((d) => !Number.isNaN(d.getTime())),
      }),
      fc.record({
        userId: fc.uuid(),
        kind: fc.constant('unverified' as const),
        emailVerifiedAt: fc.constant(null),
      }),
      fc.record({
        userId: fc.uuid(),
        kind: fc.constant('absent' as const),
        emailVerifiedAt: fc.constant(null),
      }),
    );

    await fc.assert(
      fc.asyncProperty(userArb, async (scenario) => {
        const found = scenario.kind !== 'absent';
        const fake = makeFakePrisma(scenario.emailVerifiedAt, found);
        const guard = new EmailVerifiedGuard(fake.service);
        const ctx = makeContext(scenario.userId);

        if (scenario.kind === 'verified') {
          // Req 5.5: a Verified_User is allowed through the gate.
          await expect(guard.canActivate(ctx)).resolves.toBe(true);
        } else {
          // Req 5.4: Unverified_User or absent user is rejected 403 EMAIL_NOT_VERIFIED.
          let thrown: unknown;
          try {
            await guard.canActivate(ctx);
          } catch (err) {
            thrown = err;
          }

          expect(thrown).toBeInstanceOf(EmailNotVerifiedException);
          const exception = thrown as EmailNotVerifiedException;
          expect(exception.code).toBe('EMAIL_NOT_VERIFIED');
          expect(exception.status).toBe(403);
        }

        // Read-only gate: exactly one lookup, keyed by the authenticated id, and
        // no mutation ever performed (Req 5.4 "without applying any state change").
        expect(fake.findUniqueCalls).toHaveLength(1);
        expect(fake.findUniqueCalls[0]?.where.id).toBe(scenario.userId);
        expect(fake.mutationCalls).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});
