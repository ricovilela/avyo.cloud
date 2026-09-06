import fc from 'fast-check';

import { PrismaService } from '../../common/prisma/prisma.service';
import { Argon2PasswordHasher } from './password.hasher';
import { CAPTCHA_VERIFIER, type CaptchaVerifier } from './ports/captcha-verifier';
import { MAILER, type Mailer } from './ports/mailer';
import { TokenService } from './token.service';
import { RefreshTokenService } from './refresh-token.service';
import { AuthService } from './auth.service';

// Feature: auth, Property 25: /auth/me reflects verification state
//
// Validates: Requirements 8.4, 8.5
//
// For any user, /auth/me sets user.email_verified_at to null when the user is
// unverified and to the ISO 8601 verification timestamp when verified.

/** ISO 8601 UTC instant with millisecond precision, e.g. 2024-01-02T03:04:05.678Z. */
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface UserRow {
  id: string;
  name: string;
  email: string;
  plan: string;
  emailVerifiedAt: Date | null;
}

/**
 * A minimal in-memory fake of the subset of `PrismaService` that `me()`
 * exercises: a single `user.findUnique` returning the seeded row (respecting
 * the requested `select`), or `null` when no row matches.
 */
class FakePrisma {
  constructor(private readonly row: UserRow) {}

  readonly user = {
    findUnique: (args: { where: { id: string } }) => {
      return Promise.resolve(this.row.id === args.where.id ? this.row : null);
    },
  };
}

/** Build an AuthService whose only live dependency is the fake Prisma. */
function makeService(prisma: FakePrisma): AuthService {
  return new AuthService(
    prisma as unknown as PrismaService,
    {} as unknown as Argon2PasswordHasher,
    {} as unknown as CaptchaVerifier,
    {} as unknown as Mailer,
    {} as unknown as TokenService,
    {} as unknown as RefreshTokenService,
  );
}

describe('AuthService.me property: reflects verification state (Property 25)', () => {
  it('returns null email_verified_at for unverified users and the ISO 8601 timestamp for verified users', async () => {
    const scenarioArb = fc.record({
      id: fc.uuid(),
      name: fc.string({ minLength: 1, maxLength: 64 }),
      email: fc.emailAddress(),
      plan: fc.string({ minLength: 1, maxLength: 16 }),
      // Either unverified (null) or verified with an arbitrary valid instant.
      emailVerifiedAt: fc.option(
        fc
          .date({
            min: new Date('1970-01-01T00:00:00.000Z'),
            max: new Date('2100-01-01T00:00:00.000Z'),
          })
          .filter((d) => !Number.isNaN(d.getTime())),
        { nil: null },
      ),
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const prisma = new FakePrisma({
          id: s.id,
          name: s.name,
          email: s.email,
          plan: s.plan,
          emailVerifiedAt: s.emailVerifiedAt,
        });
        const service = makeService(prisma);

        const response = await service.me(s.id);

        if (s.emailVerifiedAt === null) {
          // Unverified_User → email_verified_at is null (Req 8.4).
          expect(response.user.email_verified_at).toBeNull();
        } else {
          // Verified user → the ISO 8601 verification timestamp (Req 8.5).
          expect(response.user.email_verified_at).toBe(
            s.emailVerifiedAt.toISOString(),
          );
          expect(response.user.email_verified_at).toMatch(ISO_8601_UTC);
        }
      }),
      { numRuns: 200 },
    );
  });
});
