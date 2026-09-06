// Feature: auth, Property 14: Logout is idempotent
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';

import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';
import type { Config } from '../../config/env.validation';
import type { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Property 14 — Logout is idempotent.
 * Validates: Requirements 4.4
 *
 * For any session whose Refresh_Token is already revoked, a logout with a valid
 * Access_Token for that session responds 204 with an empty body (modelled here
 * as `AuthService.logout` resolving to `undefined` without throwing) and
 * changes no additional session state.
 *
 * The service is assembled from a REAL {@link RefreshTokenService} backed by a
 * local in-memory Prisma fake, so the property exercises the genuine
 * `logout -> revokeSession -> updateMany` control flow. `revokeSession` is an
 * `updateMany` keyed on the token hash, so replaying it against an
 * already-revoked (or unknown) token is a no-op: it flips no additional rows
 * and never throws. The other five AuthService collaborators are unused on this
 * path and are supplied as `{} as any`.
 *
 * The fake and its `rows` array are defined locally in this spec (rather than a
 * shared module) so sibling specs authored in parallel cannot collide on a
 * common file, and so the test can snapshot the full row state deep-equally
 * before and after repeated logouts.
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
  } as Config;
}

/**
 * A stable, order-preserving snapshot of the full row state limited to the
 * fields whose change would signal additional session-state mutation.
 */
function snapshotRows(rows: RefreshTokenRow[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      tokenHash: row.tokenHash,
      chainId: row.chainId,
      revoked: row.revoked,
      parentId: row.parentId,
    })),
  );
}

describe('AuthService.logout — idempotency on an already-revoked session (Req 4.4)', () => {
  // Feature: auth, Property 14: Logout is idempotent
  it('Property 14: repeated logout of an already-revoked session resolves void and changes no additional state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // the session owner
        fc.integer({ min: 1, max: 4 }), // number of extra logout replays
        // An unknown raw token that was never issued (optional extra check).
        fc
          .string({ minLength: 1, maxLength: 64 })
          .filter((s) => s.trim().length > 0),
        async (userId, extraLogouts, unknownRaw) => {
          const prisma = new InMemoryPrismaFake();
          const refreshTokenService = new RefreshTokenService(
            prisma as unknown as PrismaService,
            makeConfig(),
          );
          const authService = new AuthService(
            {} as any, // prisma — unused on the logout path
            {} as any, // hasher — unused
            {} as any, // captcha — unused
            {} as any, // mailer — unused
            {} as any, // tokenService — unused
            refreshTokenService,
          );

          // Issue a session for the user, then log out once to revoke it.
          const issued = await refreshTokenService.issue(userId, {
            user_agent: 'ua',
            os: 'os',
            browser: 'br',
          });
          const rawToken = issued.rawToken;

          await expect(authService.logout(rawToken)).resolves.toBeUndefined();

          // Snapshot the full state AFTER the first (state-changing) logout.
          const afterFirst = snapshotRows(prisma.rows);

          // Confirm the session is indeed revoked at this point.
          const hash = refreshTokenService.hashToken(rawToken);
          const revokedRow = prisma.rows.find((r) => r.tokenHash === hash);
          expect(revokedRow?.revoked).toBe(true);

          // Replay logout on the already-revoked token one or more times.
          for (let i = 0; i < extraLogouts; i += 1) {
            await expect(
              authService.logout(rawToken),
            ).resolves.toBeUndefined();
          }

          // No additional state changed by the repeated logouts (Req 4.4).
          expect(snapshotRows(prisma.rows)).toBe(afterFirst);

          // An UNKNOWN token (never issued) also resolves void and creates or
          // changes nothing.
          const neverIssued = `never-issued::${unknownRaw}`;
          await expect(
            authService.logout(neverIssued),
          ).resolves.toBeUndefined();
          expect(snapshotRows(prisma.rows)).toBe(afterFirst);
        },
      ),
      { numRuns: 100 },
    );
  });
});
