// Feature: auth, Property 19: Forgot-password is indistinguishable regardless of account existence
import fc from 'fast-check';

import { AuthService } from './auth.service';
import { RecordingMailer } from './ports/fakes/recording-mailer';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { Argon2PasswordHasher } from './password.hasher';
import type { CaptchaVerifier } from './ports/captcha-verifier';
import type { TokenService } from './token.service';
import type { RefreshTokenService } from './refresh-token.service';

/**
 * Feature: auth, Property 19 — Forgot-password is indistinguishable regardless
 * of account existence.
 *
 * Validates: Requirements 6.1, 6.2, 6.4
 *
 * For any well-formed email, whether or not it belongs to a user,
 * `forgotPassword` resolves to the identical observable result — `undefined`
 * (void), never a throw — so the controller maps both branches to `204` with an
 * empty body (Req 6.2, 6.4). A password-reset email is dispatched via the mailer
 * only when the account exists (Req 6.1); when it does not exist, zero mailer
 * calls occur and no reset token is persisted (Req 6.2).
 */
describe('AuthService.forgotPassword property: account-existence indistinguishability (Property 19)', () => {
  /** Flush the fire-and-forget mailer dispatch (a queued microtask). */
  const flushMicrotasks = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));

  it('returns the same void result for existing and non-existing accounts, dispatching a reset email iff the account exists', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.emailAddress(),
        fc.boolean(),
        async (email, exists) => {
          const mailer = new RecordingMailer();

          // Track persisted password-reset tokens so we can assert no write
          // happens on the non-existent branch (Req 6.2).
          const createdResetTokens: unknown[] = [];

          const normalized = email.trim().toLowerCase();

          const prisma = {
            user: {
              findUnique: ({ where }: { where: { email: string } }) => {
                // Only the normalized address maps to a registered user, and
                // only when this run's `exists` flag is set.
                if (exists && where.email === normalized) {
                  return Promise.resolve({
                    id: 'user-1',
                    email: normalized,
                    passwordHash: 'x',
                    emailVerifiedAt: null,
                    plan: 'ctrlsale',
                  });
                }
                return Promise.resolve(null);
              },
            },
            passwordResetToken: {
              create: (args: unknown) => {
                createdResetTokens.push(args);
                return Promise.resolve({ id: 'prt-1' });
              },
            },
          } as unknown as PrismaService;

          // forgotPassword only touches prisma + mailer + its own crypto
          // helpers, so the remaining collaborators are inert stubs.
          const hasher = {} as unknown as Argon2PasswordHasher;
          const captcha = {} as unknown as CaptchaVerifier;
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

          // Same observable result on both branches: resolves to undefined,
          // never throws (Req 6.2, 6.4 — controller maps to 204 empty body).
          const result = await service.forgotPassword({ email });
          expect(result).toBeUndefined();

          // The reset email is dispatched fire-and-forget (not awaited); let the
          // queued microtask settle before observing the recorder.
          await flushMicrotasks();

          if (exists) {
            // Email dispatched only for existing accounts (Req 6.1).
            expect(mailer.passwordResetEmails).toHaveLength(1);
            expect(mailer.passwordResetEmails[0]?.to).toBe(normalized);
            expect(createdResetTokens).toHaveLength(1);
          } else {
            // No email and no token persisted when the account is absent
            // (Req 6.2/6.4).
            expect(mailer.passwordResetEmails).toHaveLength(0);
            expect(mailer.count).toBe(0);
            expect(createdResetTokens).toHaveLength(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
