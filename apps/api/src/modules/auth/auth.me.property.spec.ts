// Feature: auth, Property 24: /auth/me returns a complete, order-stable profile and menu
import fc from 'fast-check';

import { AuthService, DEFAULT_PLAN } from './auth.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { Argon2PasswordHasher } from './password.hasher';
import type { CaptchaVerifier } from './ports/captcha-verifier';
import type { TokenService } from './token.service';
import type { RefreshTokenService } from './refresh-token.service';

/**
 * Feature: auth, Property 24 — `/auth/me` returns a complete, order-stable
 * profile and menu.
 *
 * Validates: Requirements 8.1, 8.2, 8.6
 *
 * For any valid access token, `me(userId)` responds with a user object carrying
 * non-null `id`, `name`, `email`, a `plan` (defaulting to `ctrlsale` when
 * unassigned, Req 8.6) and an `email_verified_at` field, plus a `menu` array
 * whose entries each have non-empty `key`/`label`/`route`/`icon` (Req 8.1). The
 * menu order is identical across repeated requests for the same user (Req 8.2).
 */
describe('AuthService.me property: complete, order-stable profile and menu (Property 24)', () => {
  /** A non-empty, trimmed-ish string used for id/name/email fields. */
  const nonEmptyString = fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((s) => s.trim().length > 0);

  // `plan` exercises both an assigned value and the unassigned cases ('' / null)
  // that must fall back to the default (Req 8.6).
  const planArb = fc.oneof(
    fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.length > 0),
    fc.constant(''),
    fc.constant(null),
  );

  it('returns a complete profile with a defaulted plan and an order-stable menu across repeated calls', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        nonEmptyString,
        fc.emailAddress(),
        planArb,
        fc.option(fc.date({ min: new Date(0) }), { nil: null }),
        async (id, name, email, plan, emailVerifiedAt) => {
          // Local fake Prisma: user.findUnique returns the generated row. Only
          // the selected profile columns matter to `me()`.
          const prisma = {
            user: {
              findUnique: () =>
                Promise.resolve({
                  id,
                  name,
                  email,
                  plan,
                  emailVerifiedAt,
                }),
            },
          } as unknown as PrismaService;

          // `me()` only touches prisma; the remaining collaborators are inert.
          const service = new AuthService(
            prisma,
            {} as unknown as Argon2PasswordHasher,
            {} as unknown as CaptchaVerifier,
            {} as unknown as never,
            {} as unknown as TokenService,
            {} as unknown as RefreshTokenService,
          );

          const first = await service.me(id);
          const second = await service.me(id);

          // Profile fields are non-null/non-empty and equal the stored values
          // (Req 8.1).
          expect(first.user.id).toBe(id);
          expect(first.user.id.length).toBeGreaterThan(0);
          expect(first.user.name).toBe(name);
          expect(first.user.name.length).toBeGreaterThan(0);
          expect(first.user.email).toBe(email);
          expect(first.user.email.length).toBeGreaterThan(0);

          // Plan is non-empty: the stored value when set, else the default
          // (Req 8.6).
          expect(first.user.plan.length).toBeGreaterThan(0);
          if (plan !== null && plan !== '') {
            expect(first.user.plan).toBe(plan);
          } else {
            expect(first.user.plan).toBe(DEFAULT_PLAN);
          }

          // An `email_verified_at` field is present: null or an ISO string.
          expect('email_verified_at' in first.user).toBe(true);
          if (emailVerifiedAt === null) {
            expect(first.user.email_verified_at).toBeNull();
          } else {
            expect(typeof first.user.email_verified_at).toBe('string');
            expect(first.user.email_verified_at).toBe(
              emailVerifiedAt.toISOString(),
            );
          }

          // Menu is a non-empty array; every entry carries non-empty strings
          // (Req 8.1).
          expect(Array.isArray(first.menu)).toBe(true);
          expect(first.menu.length).toBeGreaterThan(0);
          for (const entry of first.menu) {
            expect(typeof entry.key).toBe('string');
            expect(entry.key.length).toBeGreaterThan(0);
            expect(typeof entry.label).toBe('string');
            expect(entry.label.length).toBeGreaterThan(0);
            expect(typeof entry.route).toBe('string');
            expect(entry.route.length).toBeGreaterThan(0);
            expect(typeof entry.icon).toBe('string');
            expect(entry.icon.length).toBeGreaterThan(0);
          }

          // Menu order is identical across repeated requests for the same user
          // (Req 8.2).
          const firstKeys = first.menu.map((e) => e.key);
          const secondKeys = second.menu.map((e) => e.key);
          expect(firstKeys).toEqual(secondKeys);
        },
      ),
      { numRuns: 100 },
    );
  });
});
