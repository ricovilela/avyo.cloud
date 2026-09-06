import { createHash } from 'node:crypto';
import fc from 'fast-check';

import { PrismaService } from '../../common/prisma/prisma.service';
import { UnprocessableException } from '../../common/filters/app.exception';
import { Argon2PasswordHasher } from './password.hasher';
import { CAPTCHA_VERIFIER, type CaptchaVerifier } from './ports/captcha-verifier';
import { MAILER, type Mailer } from './ports/mailer';
import { TokenService } from './token.service';
import { RefreshTokenService } from './refresh-token.service';
import { AuthService } from './auth.service';

// Feature: auth, Property 16: Email verification is single-use and time-bounded
//
// Validates: Requirements 5.1, 5.2
//
// For any email-verification token: if unused and unexpired, verifying sets
// email_verified_at to now and responds 204 (verifyEmail resolves to void);
// if unknown, already used, or expired, email_verified_at is unchanged and the
// response is 422 UNPROCESSABLE.

/** Hash a raw token with the same SHA-256 hex scheme the service uses. */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

interface UserRow {
  id: string;
  emailVerifiedAt: Date | null;
}

interface TokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

/**
 * A minimal in-memory fake of the subset of `PrismaService` that
 * `verifyEmail` exercises: `emailVerificationToken.findUnique`,
 * `user.update`, `emailVerificationToken.update`, and `$transaction([...])`.
 *
 * `update` performs its mutation eagerly when invoked (verifyEmail builds the
 * update calls to assemble the transaction array before awaiting), returning a
 * resolved promise; `$transaction` simply awaits the supplied operations.
 */
class FakePrisma {
  private readonly users = new Map<string, UserRow>();
  private readonly tokensByHash = new Map<string, TokenRow>();
  private readonly tokensById = new Map<string, TokenRow>();

  seedUser(row: UserRow): void {
    this.users.set(row.id, row);
  }

  seedToken(row: TokenRow): void {
    this.tokensByHash.set(row.tokenHash, row);
    this.tokensById.set(row.id, row);
  }

  getUser(id: string): UserRow | undefined {
    return this.users.get(id);
  }

  getToken(id: string): TokenRow | undefined {
    return this.tokensById.get(id);
  }

  readonly user = {
    update: (args: { where: { id: string }; data: { emailVerifiedAt: Date } }) => {
      const existing = this.users.get(args.where.id);
      if (existing !== undefined) {
        existing.emailVerifiedAt = args.data.emailVerifiedAt;
      }
      return Promise.resolve(existing);
    },
  };

  readonly emailVerificationToken = {
    findUnique: (args: { where: { tokenHash: string } }) => {
      return Promise.resolve(this.tokensByHash.get(args.where.tokenHash) ?? null);
    },
    update: (args: { where: { id: string }; data: { usedAt: Date } }) => {
      const existing = this.tokensById.get(args.where.id);
      if (existing !== undefined) {
        existing.usedAt = args.data.usedAt;
      }
      return Promise.resolve(existing);
    },
  };

  $transaction<T>(ops: Array<Promise<T>>): Promise<T[]> {
    return Promise.all(ops);
  }
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

describe('AuthService.verifyEmail property: single-use and time-bounded (Property 16)', () => {
  it('verifies unused/unexpired tokens (204 + state stamped) and rejects unknown/used/expired with 422 leaving state unchanged', async () => {
    // A verification scenario is one of four states. `raw` is the token the
    // caller presents; for `unknown` the seeded token (if any) uses a different
    // raw value so the presented hash never matches.
    const scenarioArb = fc
      .record({
        userId: fc.uuid(),
        tokenId: fc.uuid(),
        rawToken: fc.string({ minLength: 1, maxLength: 64 }),
        unknownRawToken: fc.string({ minLength: 1, maxLength: 64 }),
        // Seed the user with either an existing verification timestamp or none,
        // so we can assert it is left untouched on the failure branches.
        preVerifiedAt: fc.option(
          fc
            .date({
              min: new Date('2000-01-01T00:00:00.000Z'),
              max: new Date('2020-01-01T00:00:00.000Z'),
            })
            .filter((d) => !Number.isNaN(d.getTime())),
          { nil: null },
        ),
        // Minutes the token expires relative to now: positive = future (valid
        // window), non-positive = past (expired).
        futureMinutes: fc.integer({ min: 1, max: 60 * 24 }),
        pastMinutes: fc.integer({ min: 0, max: 60 * 24 }),
        state: fc.constantFrom(
          'valid' as const,
          'used' as const,
          'expired' as const,
          'unknown' as const,
        ),
      })
      // Guard: the presented and the "unknown" raw tokens must differ so the
      // unknown branch truly has no matching row.
      .filter((s) => s.rawToken !== s.unknownRawToken);

    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const prisma = new FakePrisma();
        prisma.seedUser({ id: s.userId, emailVerifiedAt: s.preVerifiedAt });

        const now = Date.now();
        const futureExpiry = new Date(now + s.futureMinutes * 60_000);
        const pastExpiry = new Date(now - s.pastMinutes * 60_000);

        // Seed a token row unless the scenario is "unknown" (no matching hash).
        if (s.state === 'valid') {
          prisma.seedToken({
            id: s.tokenId,
            userId: s.userId,
            tokenHash: hashToken(s.rawToken),
            expiresAt: futureExpiry,
            usedAt: null,
          });
        } else if (s.state === 'used') {
          prisma.seedToken({
            id: s.tokenId,
            userId: s.userId,
            tokenHash: hashToken(s.rawToken),
            expiresAt: futureExpiry,
            usedAt: new Date(now - 60_000),
          });
        } else if (s.state === 'expired') {
          prisma.seedToken({
            id: s.tokenId,
            userId: s.userId,
            tokenHash: hashToken(s.rawToken),
            expiresAt: pastExpiry,
            usedAt: null,
          });
        } else {
          // unknown: seed a token under a DIFFERENT hash so the presented raw
          // token resolves to no row.
          prisma.seedToken({
            id: s.tokenId,
            userId: s.userId,
            tokenHash: hashToken(s.unknownRawToken),
            expiresAt: futureExpiry,
            usedAt: null,
          });
        }

        const service = makeService(prisma);

        if (s.state === 'valid') {
          // Unused + unexpired → resolves (204 semantics), stamps the user's
          // email_verified_at and burns the token (Req 5.1).
          await expect(service.verifyEmail({ token: s.rawToken })).resolves.toBeUndefined();

          const user = prisma.getUser(s.userId);
          expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
          // The stamp is fresh, not the pre-seeded value.
          expect(user?.emailVerifiedAt).not.toEqual(s.preVerifiedAt);

          const token = prisma.getToken(s.tokenId);
          expect(token?.usedAt).toBeInstanceOf(Date);
        } else {
          // Unknown / used / expired → 422 UNPROCESSABLE, state unchanged
          // (Req 5.2).
          let thrown: unknown;
          try {
            await service.verifyEmail({ token: s.rawToken });
          } catch (err) {
            thrown = err;
          }

          expect(thrown).toBeInstanceOf(UnprocessableException);
          const exception = thrown as UnprocessableException;
          expect(exception.code).toBe('UNPROCESSABLE');
          expect(exception.status).toBe(422);

          // email_verified_at must be exactly what it was before the call.
          const user = prisma.getUser(s.userId);
          expect(user?.emailVerifiedAt).toEqual(s.preVerifiedAt);
        }
      }),
      { numRuns: 200 },
    );
  });
});
