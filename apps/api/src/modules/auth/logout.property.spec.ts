import { randomUUID } from 'node:crypto';
import fc from 'fast-check';

import type { Config } from '../../config/env.validation';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { AppException } from '../../common/filters/app.exception';
import { RefreshTokenService } from './refresh-token.service';
import { AuthService } from './auth.service';

/**
 * Property test for logout revoking only the current session.
 *
 * // Feature: auth, Property 13: Logout revokes only the current session
 *
 * For any set of active sessions belonging to a user, logging out with a valid
 * access token revokes exactly the Refresh_Token bound to that access token's
 * session and leaves all other sessions of the same user unchanged; a
 * subsequent refresh with the revoked token yields 401 UNAUTHENTICATED.
 *
 * Validates: Requirements 4.1, 4.3, 4.5
 */

/**
 * The shape of a persisted `refresh_token` row, limited to the columns the
 * {@link RefreshTokenService} reads or writes. Field names mirror the Prisma
 * model's camelCase client accessors.
 */
interface RefreshTokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  chainId: string;
  parentId: string | null;
  revoked: boolean;
  expiresAt: Date;
  userAgent: string | null;
  os: string | null;
  browser: string | null;
  createdAt: Date;
}

/**
 * A minimal in-memory Prisma fake implementing only the `refreshToken`
 * operations plus `$transaction` used by {@link RefreshTokenService}.
 *
 * Defined locally in this spec (rather than a shared module) so sibling specs
 * authored in parallel cannot collide on a common file. The `rows` array is
 * exposed so the test can inspect per-session revocation state.
 */
class InMemoryPrismaFake {
  readonly rows: RefreshTokenRow[] = [];

  private clone(row: RefreshTokenRow): RefreshTokenRow {
    return {
      ...row,
      expiresAt: new Date(row.expiresAt),
      createdAt: new Date(row.createdAt),
    };
  }

  readonly refreshToken = {
    findUnique: async (args: {
      where: { tokenHash?: string; parentId?: string };
    }): Promise<RefreshTokenRow | null> => {
      const { tokenHash, parentId } = args.where;
      const found = this.rows.find((row) => {
        if (tokenHash !== undefined) return row.tokenHash === tokenHash;
        if (parentId !== undefined) return row.parentId === parentId;
        return false;
      });
      return found ? this.clone(found) : null;
    },

    create: async (args: {
      data: {
        userId: string;
        tokenHash: string;
        chainId: string;
        parentId?: string | null;
        expiresAt: Date;
        userAgent?: string | null;
        os?: string | null;
        browser?: string | null;
      };
    }): Promise<RefreshTokenRow> => {
      const row: RefreshTokenRow = {
        id: randomUUID(),
        userId: args.data.userId,
        tokenHash: args.data.tokenHash,
        chainId: args.data.chainId,
        parentId: args.data.parentId ?? null,
        revoked: false,
        expiresAt: args.data.expiresAt,
        userAgent: args.data.userAgent ?? null,
        os: args.data.os ?? null,
        browser: args.data.browser ?? null,
        createdAt: new Date(),
      };
      this.rows.push(row);
      return this.clone(row);
    },

    update: async (args: {
      where: { id: string };
      data: { revoked?: boolean };
    }): Promise<RefreshTokenRow> => {
      const row = this.rows.find((r) => r.id === args.where.id);
      if (!row) {
        throw new Error(`refreshToken.update: no row with id ${args.where.id}`);
      }
      if (args.data.revoked !== undefined) row.revoked = args.data.revoked;
      return this.clone(row);
    },

    updateMany: async (args: {
      where: {
        chainId?: string;
        tokenHash?: string;
        userId?: string;
        revoked?: boolean;
      };
      data: { revoked?: boolean };
    }): Promise<{ count: number }> => {
      const { chainId, tokenHash, userId, revoked } = args.where;
      let count = 0;
      for (const row of this.rows) {
        if (chainId !== undefined && row.chainId !== chainId) continue;
        if (tokenHash !== undefined && row.tokenHash !== tokenHash) continue;
        if (userId !== undefined && row.userId !== userId) continue;
        if (revoked !== undefined && row.revoked !== revoked) continue;
        if (args.data.revoked !== undefined) row.revoked = args.data.revoked;
        count += 1;
      }
      return { count };
    },
  };

  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    // The fake mutates its shared row store directly; no isolation is needed
    // for these tests, so the callback simply receives `this`.
    return fn(this);
  }
}

/** Build a {@link Config} with fixed secrets and a 7-day refresh lifetime. */
function makeConfig(): Config {
  return {
    DATABASE_URL: 'postgres://localhost:5432/test',
    JWT_SECRET: 'jwt-secret',
    JWT_EXPIRES_IN: '86400',
    REFRESH_SECRET: 'refresh-secret-value',
    REFRESH_EXPIRES_IN: '604800',
    PORT: 3000,
  };
}

describe('AuthService.logout — revokes only the current session (Req 4.1, 4.3, 4.5)', () => {
  it('Property 13: logout revokes exactly the current session, leaves others usable, and blocks refresh of the revoked token', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // the user owning all the sessions
        fc.integer({ min: 2, max: 5 }), // number of concurrent sessions
        // index of the session to log out from
        fc.integer({ min: 0, max: 4 }),
        async (userId, sessionCount, rawCurrentIndex) => {
          const prisma = new InMemoryPrismaFake();
          const refreshTokenService = new RefreshTokenService(
            prisma as unknown as PrismaService,
            makeConfig(),
          );
          // logout only touches refreshTokenService; the other five deps are
          // never exercised on this path.
          const authService = new AuthService(
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            refreshTokenService,
          );

          // Issue N distinct sessions for the same user; each starts its own
          // chain with a distinct raw token.
          const sessions: { rawToken: string; tokenId: string }[] = [];
          for (let i = 0; i < sessionCount; i += 1) {
            const issued = await refreshTokenService.issue(userId);
            sessions.push({ rawToken: issued.rawToken, tokenId: issued.tokenId });
          }

          const currentIndex = rawCurrentIndex % sessionCount;
          const current = sessions[currentIndex]!;

          // --- Act: log out from the current session ---
          await authService.logout(current.rawToken);

          // The current session's row is revoked (Req 4.1).
          const currentRow = prisma.rows.find((r) => r.id === current.tokenId);
          expect(currentRow).toBeDefined();
          expect(currentRow?.revoked).toBe(true);

          // Every OTHER session of the same user remains untouched (Req 4.5).
          for (let i = 0; i < sessions.length; i += 1) {
            if (i === currentIndex) continue;
            const row = prisma.rows.find((r) => r.id === sessions[i]!.tokenId);
            expect(row).toBeDefined();
            expect(row?.revoked).toBe(false);
          }

          // A subsequent refresh with the revoked token yields 401 (Req 4.3).
          let thrown: unknown;
          try {
            await refreshTokenService.rotate(current.rawToken);
          } catch (err) {
            thrown = err;
          }
          expect(thrown).toBeInstanceOf(AppException);
          expect((thrown as AppException).code).toBe('UNAUTHENTICATED');
          expect((thrown as AppException).status).toBe(401);

          // Any other session's token still refreshes successfully, proving the
          // other sessions are usable and unchanged (Req 4.5).
          const otherIndex = (currentIndex + 1) % sessionCount;
          const rotated = await refreshTokenService.rotate(
            sessions[otherIndex]!.rawToken,
          );
          expect(typeof rotated.rawToken).toBe('string');
          expect(rotated.rawToken).not.toBe(sessions[otherIndex]!.rawToken);
          expect(rotated.userId).toBe(userId);
        },
      ),
      { numRuns: 100 },
    );
  });
});
