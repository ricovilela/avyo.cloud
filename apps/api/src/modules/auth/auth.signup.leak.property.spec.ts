// Feature: auth, Property 1: Signup never leaks credentials
import fc from 'fast-check';

import { AuthService } from './auth.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { Argon2PasswordHasher } from './password.hasher';
import type { CaptchaVerifier } from './ports/captcha-verifier';
import type { Mailer } from './ports/mailer';
import type { TokenService } from './token.service';
import type { RefreshTokenService } from './refresh-token.service';

/**
 * Feature: auth, Property 1 — Signup never leaks credentials.
 *
 * Validates: Requirements 1.3
 *
 * For any valid signup input, the signup response body contains neither a
 * `password` nor a `password_hash` field (at any nesting level), and the
 * persisted user's `password_hash` is not equal to the plaintext password.
 *
 * A FAST fake hasher is used (returns a value derived from — but never equal to
 * — the plaintext) so the property runs at high iteration counts while still
 * letting us assert the stored hash differs from the plaintext. The persisted
 * `passwordHash` is captured from the fake `tx.user.create` so we can inspect
 * exactly what the service stored.
 */

/**
 * Recursively collect every key name appearing anywhere in a value (objects and
 * arrays, at any nesting depth), so we can assert a forbidden credential key is
 * absent from the entire response shape rather than just its top level.
 */
function collectKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, acc);
    }
  } else if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      acc.add(key);
      collectKeys(nested, acc);
    }
  }
  return acc;
}

describe('AuthService.signup property: never leaks credentials (Property 1)', () => {
  /** Flush the fire-and-forget verification email dispatch (a queued microtask). */
  const flushMicrotasks = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));

  // Valid signup inputs mirroring the SignupDto constraints: name 1–255,
  // a well-formed email 3–254, password 8–128, and non-empty captcha fields.
  const signupArb = fc.record({
    name: fc.string({ minLength: 1, maxLength: 255 }),
    email: fc.emailAddress(),
    password: fc.string({ minLength: 8, maxLength: 128 }),
    captcha0: fc.string({ minLength: 1, maxLength: 32 }),
    captcha1: fc.string({ minLength: 1, maxLength: 32 }),
  });

  it('returns exactly { id, email, email_verified_at } with no credential key at any depth, and stores a hash that differs from the plaintext', async () => {
    await fc.assert(
      fc.asyncProperty(signupArb, async (dto) => {
        // Capture the row the service asks the transaction to create so we can
        // inspect the persisted passwordHash.
        let createdUser:
          | {
              id: string;
              name: string;
              email: string;
              passwordHash: string;
              emailVerifiedAt: Date | null;
              plan: string;
            }
          | undefined;

        const prisma = {
          user: {
            // No duplicate: the email is free.
            findUnique: () => Promise.resolve(null),
          },
          $transaction: (fn: (tx: unknown) => Promise<unknown>) => {
            const tx = {
              user: {
                create: (args: { data: { name: string; email: string; passwordHash: string } }) => {
                  createdUser = {
                    id: '11111111-1111-4111-8111-111111111111',
                    name: args.data.name,
                    email: args.data.email,
                    passwordHash: args.data.passwordHash,
                    emailVerifiedAt: null,
                    plan: 'ctrlsale',
                  };
                  return Promise.resolve(createdUser);
                },
              },
              emailVerificationToken: {
                create: () => Promise.resolve({}),
              },
            };
            return fn(tx);
          },
        } as unknown as PrismaService;

        // FAST fake hasher: derives a value from the plaintext but never equals
        // it, so the property stays cheap while the hash-vs-plaintext assertion
        // remains meaningful (Req 1.3).
        const hasher = {
          hash: (plain: string) => Promise.resolve(`hashed:${plain}:${'x'.repeat(20)}`),
          verify: () => Promise.resolve(true),
        } as unknown as Argon2PasswordHasher;

        const captcha = {
          verify: () => Promise.resolve(true),
        } as unknown as CaptchaVerifier;

        // No-op mailer; dispatch is fire-and-forget and irrelevant to this
        // property.
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
        await flushMicrotasks();

        // No credential key leaks at any nesting level of the response (Req 1.3).
        const keys = collectKeys(response);
        expect(keys.has('password')).toBe(false);
        expect(keys.has('password_hash')).toBe(false);
        expect(keys.has('passwordHash')).toBe(false);

        // The response is exactly the public shape.
        expect(Object.keys(response).sort()).toEqual(
          ['email', 'email_verified_at', 'id'].sort(),
        );

        // The persisted hash exists and is never the plaintext password (Req 1.3).
        expect(createdUser).toBeDefined();
        expect(createdUser?.passwordHash).toBeDefined();
        expect(createdUser?.passwordHash).not.toBe(dto.password);
      }),
      { numRuns: 200 },
    );
  });
});
