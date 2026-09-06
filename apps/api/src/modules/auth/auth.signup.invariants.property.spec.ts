// Feature: auth, Property 2: Signup output invariants
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';

import { AuthService } from './auth.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { Argon2PasswordHasher } from './password.hasher';
import type { CaptchaVerifier } from './ports/captcha-verifier';
import type { Mailer } from './ports/mailer';
import type { TokenService } from './token.service';
import type { RefreshTokenService } from './refresh-token.service';

/**
 * Feature: auth, Property 2 — Signup output invariants.
 *
 * Validates: Requirements 1.1, 1.2, 11.3
 *
 * For any accepted signup input, the created User has `email_verified_at` equal
 * to null and `plan` equal to `ctrlsale` (Req 1.1), and the response body
 * contains a valid version-4 UUID `id` (Req 11.3) plus the submitted `email`
 * normalized to trimmed lowercase with `email_verified_at` null (Req 1.2).
 */

/** RFC 4122 version-4 UUID matcher (variant 8/9/a/b, version nibble 4). */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('AuthService.signup property: output invariants (Property 2)', () => {
  it('creates a ctrlsale/unverified user and returns a v4 UUID id with the normalized submitted email', async () => {
    // Valid signup inputs per Req 1.1 acceptance ranges. `fc.emailAddress()`
    // yields RFC-conformant addresses; constrain length to the 3..254 window.
    const dtoArb = fc.record({
      name: fc.string({ minLength: 1, maxLength: 255 }),
      email: fc
        .emailAddress()
        .filter((e) => e.length >= 3 && e.length <= 254),
      password: fc.string({ minLength: 8, maxLength: 128 }),
      captcha0: fc.string({ minLength: 1, maxLength: 32 }),
      captcha1: fc.string({ minLength: 1, maxLength: 32 }),
    });

    await fc.assert(
      fc.asyncProperty(dtoArb, async (dto) => {
        // Capture the exact `data` the service persists so we can assert the
        // stored plan / verification stamp independent of the response shape.
        let createdUserData:
          | { plan: string; emailVerifiedAt: Date | null; email: string }
          | undefined;

        const tx = {
          user: {
            create: (args: {
              data: {
                name: string;
                email: string;
                passwordHash: string;
                emailVerifiedAt: Date | null;
                plan: string;
              };
            }) => {
              createdUserData = {
                plan: args.data.plan,
                emailVerifiedAt: args.data.emailVerifiedAt,
                email: args.data.email,
              };
              // A real v4 UUID id, echoing the persisted row back.
              return Promise.resolve({ id: randomUUID(), ...args.data });
            },
          },
          emailVerificationToken: {
            create: () => Promise.resolve({}),
          },
        };

        const prisma = {
          user: {
            // No existing account → signup proceeds past the conflict check.
            findUnique: () => Promise.resolve(null),
          },
          $transaction: <T>(fn: (txArg: typeof tx) => Promise<T>) => fn(tx),
        } as unknown as PrismaService;

        // Only prisma is exercised meaningfully; the rest are fast local fakes.
        const hasher = {
          hash: () => Promise.resolve('h'),
          verify: () => Promise.resolve(true),
        } as unknown as Argon2PasswordHasher;
        const captcha = {
          verify: () => Promise.resolve(true),
        } as unknown as CaptchaVerifier;
        const mailer = {
          sendVerificationEmail: () => Promise.resolve(),
          sendPasswordResetEmail: () => Promise.resolve(),
        } as unknown as Mailer;
        const tokenService = {} as unknown as TokenService;
        const refreshTokenService = {} as unknown as RefreshTokenService;

        const service = new AuthService(
          prisma,
          hasher,
          captcha,
          mailer,
          tokenService,
          refreshTokenService,
        );

        const response = await service.signup(dto);

        const normalizedEmail = dto.email.trim().toLowerCase();

        // Req 1.2: response echoes the submitted email (normalized) and null
        // verification stamp.
        expect(response.email).toBe(normalizedEmail);
        expect(response.email_verified_at).toBeNull();

        // Req 11.3: the assigned id is a version-4 UUID.
        expect(response.id).toMatch(UUID_V4);

        // Req 1.1: the persisted user is unverified and on the ctrlsale plan.
        expect(createdUserData).toBeDefined();
        expect(createdUserData?.emailVerifiedAt).toBeNull();
        expect(createdUserData?.plan).toBe('ctrlsale');
        expect(createdUserData?.email).toBe(normalizedEmail);
      }),
      { numRuns: 200 },
    );
  });
});
