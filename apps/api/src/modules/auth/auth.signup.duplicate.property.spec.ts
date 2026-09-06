// Feature: auth, Property 3: Duplicate email is rejected case-insensitively
import fc from 'fast-check';

import { AuthService } from './auth.service';
import { ConflictException } from '../../common/filters/app.exception';
import { RecordingMailer } from './ports/fakes/recording-mailer';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { Argon2PasswordHasher } from './password.hasher';
import type { CaptchaVerifier } from './ports/captcha-verifier';
import type { TokenService } from './token.service';
import type { RefreshTokenService } from './refresh-token.service';

/**
 * Feature: auth, Property 3 — Duplicate email is rejected case-insensitively.
 *
 * Validates: Requirements 1.5
 *
 * For any existing User email and any case-variant of that email (including
 * surrounding whitespace, since signup trims), a signup request with the
 * variant is rejected with `409 CONFLICT` and creates no new User. The service
 * normalizes the incoming email (trim + lowercase) before the duplicate lookup,
 * so a variant that lowercases to the seeded (already-lowercased) address must
 * collide and short-circuit before any `user.create` / `$transaction` runs.
 */
describe('AuthService.signup property: case-insensitive duplicate rejection (Property 3)', () => {
  /**
   * Randomly re-case each alphabetic character of `base` and optionally pad the
   * result with surrounding ASCII whitespace, producing a case/whitespace
   * variant whose trimmed lowercase equals `base.toLowerCase()`.
   */
  const caseWhitespaceVariant = (base: string): fc.Arbitrary<string> =>
    fc
      .tuple(
        fc.array(fc.boolean(), { minLength: base.length, maxLength: base.length }),
        fc.stringMatching(/^[ \t\n\r]*$/),
        fc.stringMatching(/^[ \t\n\r]*$/),
      )
      .map(([uppers, leading, trailing]) => {
        const recased = Array.from(base)
          .map((ch, i) => (uppers[i] ? ch.toUpperCase() : ch.toLowerCase()))
          .join('');
        return `${leading}${recased}${trailing}`;
      });

  it('rejects any case/whitespace variant of an existing email with 409 CONFLICT and creates no user', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress().chain((base) =>
          fc.record({
            base: fc.constant(base),
            variant: caseWhitespaceVariant(base),
            name: fc.string({ minLength: 1, maxLength: 255 }),
            password: fc.string({ minLength: 8, maxLength: 128 }),
            captcha0: fc.string({ minLength: 1 }),
            captcha1: fc.string({ minLength: 1 }),
          }),
        ),
        async ({ base, variant, name, password, captcha0, captcha1 }) => {
          // The seeded existing user is stored under the normalized address.
          const existingEmail = base.trim().toLowerCase();

          let createCalled = false;
          let transactionCalled = false;

          const prisma = {
            user: {
              findUnique: ({ where }: { where: { email: string } }) => {
                // The service passes an already-normalized email; a match means
                // the incoming variant collides with the seeded account.
                if (where.email === existingEmail) {
                  return Promise.resolve({
                    id: 'existing-user',
                    email: existingEmail,
                    passwordHash: 'seeded-hash',
                    emailVerifiedAt: null,
                    plan: 'ctrlsale',
                  });
                }
                return Promise.resolve(null);
              },
              create: () => {
                createCalled = true;
                return Promise.resolve({ id: 'new-user' });
              },
            },
            emailVerificationToken: {
              create: () => Promise.resolve({ id: 'evt-1' }),
            },
            $transaction: (fnOrArr: unknown) => {
              transactionCalled = true;
              if (typeof fnOrArr === 'function') {
                const tx = {
                  user: {
                    create: () => {
                      createCalled = true;
                      return Promise.resolve({ id: 'new-user' });
                    },
                  },
                  emailVerificationToken: {
                    create: () => Promise.resolve({ id: 'evt-1' }),
                  },
                };
                return (fnOrArr as (tx: unknown) => Promise<unknown>)(tx);
              }
              return Promise.resolve([]);
            },
          } as unknown as PrismaService;

          // A fast, deterministic fake hasher — signup must never reach it here.
          const hasher = {
            hash: () => Promise.resolve('fake-hash'),
            verify: () => Promise.resolve(true),
          } as unknown as Argon2PasswordHasher;

          // Captcha always passes so the duplicate check is what rejects.
          const captcha = {
            verify: () => Promise.resolve(true),
          } as unknown as CaptchaVerifier;

          const mailer = new RecordingMailer();
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

          // Sanity: the variant must normalize back to the seeded email so the
          // scenario genuinely exercises case-insensitive collision (Req 1.5).
          expect(variant.trim().toLowerCase()).toBe(existingEmail);

          let thrown: unknown;
          try {
            await service.signup({ name, email: variant, password, captcha0, captcha1 });
          } catch (error) {
            thrown = error;
          }

          // Rejected with 409 CONFLICT (Req 1.5).
          expect(thrown).toBeInstanceOf(ConflictException);
          expect((thrown as ConflictException).code).toBe('CONFLICT');
          expect((thrown as ConflictException).status).toBe(409);

          // No new user was created — the duplicate check short-circuits before
          // any create / transaction (Req 1.5).
          expect(createCalled).toBe(false);
          expect(transactionCalled).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
