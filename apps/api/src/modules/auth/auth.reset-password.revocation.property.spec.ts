// Feature: auth, Property 22: Reset-password consumes its token and revokes all sessions
import { createHash, randomBytes } from 'node:crypto';
import fc from 'fast-check';

import { AuthService } from './auth.service';
import { AppException } from '../../common/filters/app.exception';
import type { ResetPasswordDto } from './dto/reset-password.dto';

/**
 * Property 22 — Reset-password consumes its token and revokes all sessions.
 * Validates: Requirements 7.2, 7.3
 *
 * For any successful reset, the presented reset token is marked used (a second
 * use is rejected) and every active refresh token of that user is revoked (none
 * can be exchanged afterward).
 *
 * The service is assembled from LOCAL, in-spec fakes so the property exercises
 * the real `AuthService.resetPassword` control flow — token lookup, the
 * transactional consume, and the follow-up revoke — without any real database
 * or crypto cost:
 *
 * - The fake PrismaService keeps `passwordResetToken` rows in an array. A
 *   `findUnique` by `tokenHash` returns the live row object, so once the
 *   transactional `update` stamps `usedAt`, a subsequent lookup observes the
 *   consumed state. `$transaction(ops[])` mirrors the real client by resolving
 *   the array of pending operations together.
 * - A trivial fake hasher keeps runs fast; this property concerns token
 *   consumption and session revocation, not hash correctness.
 * - `refreshTokenService.revokeAllForUser` is a spy so we can assert it fires
 *   exactly once for the token's owner (Req 7.3).
 */

/** Compute the persisted SHA-256 hex digest for a raw reset token. */
function hashRawToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** A mutable stand-in for a persisted Password_Reset_Token row. */
interface ResetTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
}

interface UserRow {
  id: string;
  passwordHash: string;
}

/**
 * Build an AuthService wired to local fakes seeded with a single valid
 * (unused, unexpired) reset token for `userId` whose raw value is `rawToken`.
 */
function buildService(userId: string, rawToken: string): {
  service: AuthService;
  tokenRow: ResetTokenRow;
  userRow: UserRow;
  revokeAllForUser: jest.Mock;
} {
  const userRow: UserRow = { id: userId, passwordHash: 'old-hash' };

  const tokenRow: ResetTokenRow = {
    id: randomBytes(8).toString('hex'),
    userId,
    tokenHash: hashRawToken(rawToken),
    // Valid for an hour from now — safely unexpired for the test duration.
    expiresAt: new Date(Date.now() + 3_600_000),
    usedAt: null,
  };

  const tokens: ResetTokenRow[] = [tokenRow];
  const users: UserRow[] = [userRow];

  const prisma = {
    passwordResetToken: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        tokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
      // Returns a thunk so `$transaction` can execute it as a pending op.
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: { usedAt: Date };
      }) => ({
        __run: () => {
          const row = tokens.find((t) => t.id === where.id);
          if (row) {
            row.usedAt = data.usedAt;
          }
          return row;
        },
      }),
    },
    user: {
      update: ({
        where,
        data,
      }: {
        where: { id: string };
        data: { passwordHash: string };
      }) => ({
        __run: () => {
          const row = users.find((u) => u.id === where.id);
          if (row) {
            row.passwordHash = data.passwordHash;
          }
          return row;
        },
      }),
    },
    // Mirror PrismaClient's array form: resolve every pending op together.
    $transaction: async (ops: Array<{ __run: () => unknown }>) =>
      Promise.all(ops.map((op) => op.__run())),
  } as any;

  const hasher = {
    hash: async () => 'new-hash',
    verify: async () => true,
  } as any;

  const revokeAllForUser = jest.fn(async () => {});
  const refreshTokenService = { revokeAllForUser } as any;

  const service = new AuthService(
    prisma,
    hasher,
    {} as any, // captcha — unused on this path
    {} as any, // mailer — unused on this path
    {} as any, // tokenService — unused on this path
    refreshTokenService,
  );

  return { service, tokenRow, userRow, revokeAllForUser };
}

describe('AuthService.resetPassword — token consumption + full session revocation (Req 7.2, 7.3)', () => {
  // Feature: auth, Property 22: Reset-password consumes its token and revokes all sessions
  it('consumes the reset token (second use rejected) and revokes all sessions for the owner', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        // A valid 8–128 char password (DTO bounds), non-blank.
        fc.string({ minLength: 8, maxLength: 128 }),
        // A high-entropy raw token, as issued by the service.
        fc.constant(null).map(() => randomBytes(32).toString('base64url')),
        async (userId, password, rawToken) => {
          const { service, tokenRow, revokeAllForUser } = buildService(
            userId,
            rawToken,
          );

          const dto: ResetPasswordDto = { token: rawToken, password };

          // First reset must succeed.
          await expect(service.resetPassword(dto)).resolves.toBeUndefined();

          // Req 7.3 — every active refresh token of the user is revoked, via a
          // single revokeAllForUser call scoped to the token's owner.
          expect(revokeAllForUser).toHaveBeenCalledTimes(1);
          expect(revokeAllForUser).toHaveBeenCalledWith(userId);

          // Req 7.2 — the presented token is now consumed (usedAt stamped).
          expect(tokenRow.usedAt).not.toBeNull();

          // Req 7.2 — a second use of the SAME raw token is rejected as 422
          // UNPROCESSABLE and performs no further revocation.
          let error: unknown;
          try {
            await service.resetPassword(dto);
          } catch (err) {
            error = err;
          }
          expect(error).toBeInstanceOf(AppException);
          expect((error as AppException).code).toBe('UNPROCESSABLE');
          expect((error as AppException).status).toBe(422);

          // The rejected replay triggered no additional session revocation.
          expect(revokeAllForUser).toHaveBeenCalledTimes(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
