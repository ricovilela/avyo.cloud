import { createHash } from 'node:crypto';
import fc from 'fast-check';

import { AuthService } from './auth.service';
import { Argon2PasswordHasher } from './password.hasher';
import { AppException } from '../../common/filters/app.exception';

// Feature: auth, Property 21: Reset-password succeeds only for valid tokens and updates the hash

/**
 * Feature: auth, Property 21: Reset-password succeeds only for valid tokens and
 * updates the hash
 *
 * Validates: Requirements 7.1, 7.4
 *
 * For any known/unexpired/unused Password_Reset_Token and a password 8–128
 * chars, {@link AuthService.resetPassword} rehashes the new password, updates
 * the user's `password_hash` to that hash, marks the token used, and resolves
 * (the controller renders `204`) — the stored hash verifies against the new
 * password (Req 7.1). For any expired, unknown, or already-used token, the
 * user's `password_hash` is left unchanged and the call rejects with a
 * `422 UNPROCESSABLE` {@link AppException} (Req 7.4).
 */

// Argon2id is memory-hard and therefore slow; give the suite generous headroom.
jest.setTimeout(60_000);

/** SHA-256 hex digest matching AuthService's private hashResetToken. */
function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

interface UserRow {
  id: string;
  passwordHash: string;
}

interface TokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  usedAt: Date | null;
  expiresAt: Date;
}

/**
 * Build an AuthService wired to in-memory fakes and a REAL Argon2 hasher.
 *
 * The Prisma fake exposes only what resetPassword touches:
 * - passwordResetToken.findUnique({ where: { tokenHash } })
 * - user.update / passwordResetToken.update — return promise-likes that mutate
 *   the seeded rows when awaited (executed inside $transaction).
 * - $transaction(ops[]) => Promise.all(ops), so the update promise-likes run.
 */
function buildService(userRow: UserRow, tokenRow: TokenRow | null): {
  service: AuthService;
  revokeAllForUser: jest.Mock;
} {
  const tokens: TokenRow[] = tokenRow ? [tokenRow] : [];
  const users: UserRow[] = [userRow];

  const prisma = {
    passwordResetToken: {
      findUnique: ({ where: { tokenHash } }: { where: { tokenHash: string } }) =>
        Promise.resolve(tokens.find((t) => t.tokenHash === tokenHash) ?? null),
      update: ({
        where: { id },
        data,
      }: {
        where: { id: string };
        data: { usedAt: Date };
      }) => ({
        then: (resolve: (v: unknown) => unknown) => {
          const row = tokens.find((t) => t.id === id);
          if (row) row.usedAt = data.usedAt;
          return Promise.resolve(row).then(resolve);
        },
      }),
    },
    user: {
      update: ({
        where: { id },
        data,
      }: {
        where: { id: string };
        data: { passwordHash: string };
      }) => ({
        then: (resolve: (v: unknown) => unknown) => {
          const row = users.find((u) => u.id === id);
          if (row) row.passwordHash = data.passwordHash;
          return Promise.resolve(row).then(resolve);
        },
      }),
    },
    $transaction: (ops: PromiseLike<unknown>[]) => Promise.all(ops),
  };

  const revokeAllForUser = jest.fn().mockResolvedValue(undefined);
  const refreshTokenService = { revokeAllForUser } as unknown as never;

  const service = new AuthService(
    prisma as never,
    new Argon2PasswordHasher(),
    {} as never,
    {} as never,
    {} as never,
    refreshTokenService,
  );

  return { service, revokeAllForUser };
}

type TokenState = 'valid' | 'used' | 'expired' | 'unknown';

describe('AuthService property: reset-password succeeds only for valid tokens and updates the hash (Property 21)', () => {
  it('updates the hash for valid tokens (204) and leaves it unchanged for used/expired/unknown tokens (422)', async () => {
    const hasher = new Argon2PasswordHasher();

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<TokenState>('valid', 'used', 'expired', 'unknown'),
        // Raw token delivered to reset-password; hashed to locate the row.
        fc.string({ minLength: 1, maxLength: 64 }),
        // New password constrained to the DTO's 8–128 char window.
        fc.string({ minLength: 8, maxLength: 128 }),
        async (state, rawToken, newPassword) => {
          const now = Date.now();
          const userId = 'user-1';

          // The user starts with a hash of some prior password, so any change is
          // observable and we can assert "unchanged" precisely.
          const originalHash = await hasher.hash('old-password-123');
          const userRow: UserRow = { id: userId, passwordHash: originalHash };

          // Seed a token row for every state except "unknown" (no row at all).
          let tokenRow: TokenRow | null = null;
          if (state !== 'unknown') {
            tokenRow = {
              id: 'token-1',
              userId,
              tokenHash: sha256Hex(rawToken),
              usedAt: state === 'used' ? new Date(now - 1_000) : null,
              expiresAt:
                state === 'expired'
                  ? new Date(now - 1_000)
                  : new Date(now + 3_600_000),
            };
          }

          const { service, revokeAllForUser } = buildService(userRow, tokenRow);

          if (state === 'valid') {
            await expect(
              service.resetPassword({ token: rawToken, password: newPassword }),
            ).resolves.toBeUndefined();

            // Req 7.1: the stored hash changed and now verifies the new password.
            expect(userRow.passwordHash).not.toBe(originalHash);
            await expect(
              hasher.verify(userRow.passwordHash, newPassword),
            ).resolves.toBe(true);

            // Token burned (single-use) and sessions revoked.
            expect(tokenRow?.usedAt).not.toBeNull();
            expect(revokeAllForUser).toHaveBeenCalledWith(userId);
          } else {
            // Req 7.4: invalid token → 422 UNPROCESSABLE and hash unchanged.
            let thrown: unknown;
            try {
              await service.resetPassword({
                token: rawToken,
                password: newPassword,
              });
            } catch (err) {
              thrown = err;
            }

            expect(thrown).toBeInstanceOf(AppException);
            expect((thrown as AppException).code).toBe('UNPROCESSABLE');
            expect((thrown as AppException).status).toBe(422);
            expect(userRow.passwordHash).toBe(originalHash);
            expect(revokeAllForUser).not.toHaveBeenCalled();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
