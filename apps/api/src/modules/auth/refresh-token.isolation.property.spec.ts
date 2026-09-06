import { randomUUID } from 'node:crypto';
import fc from 'fast-check';

import type { Config } from '../../config/env.validation';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { AppException } from '../../common/filters/app.exception';
import { RefreshTokenService } from './refresh-token.service';

/**
 * Property test for Refresh_Token chain isolation on invalid input.
 *
 * // Feature: auth, Property 11: Invalid/revoked/expired refresh isolates other chains
 *
 * For any non-empty refresh-token string that is revoked, expired, or unknown,
 * `rotate()` fails with 401 UNAUTHENTICATED, no new token is issued, and every
 * OTHER chain's tokens remain unchanged.
 *
 * Validates: Requirements 3.4
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
 * exposed so the test can snapshot an unrelated chain before/after an operation.
 */
class InMemoryPrismaFake {
  readonly rows: RefreshTokenRow[] = [];

  private clone(row: RefreshTokenRow): RefreshTokenRow {
    return { ...row, expiresAt: new Date(row.expiresAt), createdAt: new Date(row.createdAt) };
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
      where: { chainId?: string; tokenHash?: string; userId?: string; revoked?: boolean };
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

/** A stable, order-preserving snapshot of the fields that must not change. */
function snapshotChain(rows: RefreshTokenRow[], chainId: string): string {
  return JSON.stringify(
    rows
      .filter((row) => row.chainId === chainId)
      .map((row) => ({
        id: row.id,
        userId: row.userId,
        tokenHash: row.tokenHash,
        chainId: row.chainId,
        parentId: row.parentId,
        revoked: row.revoked,
        expiresAt: row.expiresAt.toISOString(),
      })),
  );
}

type FailureCase = 'unknown' | 'revoked' | 'expired';

describe('RefreshTokenService — chain isolation on invalid refresh (Req 3.4)', () => {
  it('Property 11: revoked/expired/unknown refresh is 401, issues no token, and leaves other chains unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<FailureCase>('unknown', 'revoked', 'expired'),
        fc.uuid(), // user A (subject of the bad rotate)
        fc.uuid(), // user B (owner of the unrelated healthy chain)
        fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0),
        async (failureCase, userIdA, userIdB, unknownToken) => {
          const prisma = new InMemoryPrismaFake();
          const service = new RefreshTokenService(
            prisma as unknown as PrismaService,
            makeConfig(),
          );

          // --- Set up the healthy, unrelated chain for user B ---
          const bIssued = await service.issue(userIdB, {
            user_agent: 'ua-B',
            os: 'os-B',
            browser: 'br-B',
          });
          const otherChainId = bIssued.chainId;
          const beforeOther = snapshotChain(prisma.rows, otherChainId);

          // --- Prepare the bad token for the failing case ---
          let badToken: string;
          if (failureCase === 'unknown') {
            // A random string that was never issued; ensure it does not collide
            // with the healthy chain's token.
            badToken = `never-issued::${unknownToken}`;
          } else if (failureCase === 'revoked') {
            const aIssued = await service.issue(userIdA);
            await service.revokeSession(aIssued.rawToken);
            badToken = aIssued.rawToken;
          } else {
            const aIssued = await service.issue(userIdA);
            // Force expiry by moving the stored row's expiresAt into the past.
            const hash = service.hashToken(aIssued.rawToken);
            const row = prisma.rows.find((r) => r.tokenHash === hash);
            if (!row) throw new Error('expected issued row to exist');
            row.expiresAt = new Date(Date.now() - 60_000);
            badToken = aIssued.rawToken;
          }

          const countBefore = prisma.rows.length;

          // --- Attempt rotation with the bad token ---
          let thrown: unknown;
          try {
            await service.rotate(badToken);
          } catch (err) {
            thrown = err;
          }

          // 401 UNAUTHENTICATED
          expect(thrown).toBeInstanceOf(AppException);
          expect((thrown as AppException).code).toBe('UNAUTHENTICATED');
          expect((thrown as AppException).status).toBe(401);

          // No new token issued (no successor row created for the bad token).
          expect(prisma.rows.length).toBe(countBefore);

          // The unrelated chain B is byte-for-byte unchanged.
          const afterOther = snapshotChain(prisma.rows, otherChainId);
          expect(afterOther).toBe(beforeOther);
        },
      ),
      { numRuns: 100 },
    );
  });
});
