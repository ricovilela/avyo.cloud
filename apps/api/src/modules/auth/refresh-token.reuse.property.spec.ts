import fc from 'fast-check';
import { randomUUID } from 'node:crypto';

import { RefreshTokenService } from './refresh-token.service';
import type { Config } from '../../config/env.validation';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UnauthenticatedException } from '../../common/filters/app.exception';

/**
 * Property-based test for reuse-triggered chain revocation.
 *
 * Validates: Requirements 3.3
 *
 * Property 10 (Reuse of a rotated token revokes the whole chain): for any
 * Refresh_Token that has already been rotated (a successor exists), presenting
 * it again revokes every token in its chain, issues no new tokens, and responds
 * with a 401 UNAUTHENTICATED error.
 *
 * The test drives the real {@link RefreshTokenService} against a local
 * in-memory Prisma fake (defined below) so it exercises the genuine rotation /
 * reuse-detection logic without a database. The fake is intentionally private
 * to this file so parallel sibling specs cannot collide on shared state.
 */

/**
 * Minimal shape of a persisted `refresh_token` row, mirroring the Prisma model
 * fields the service reads and writes.
 */
interface FakeRow {
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
 * In-memory stand-in for the subset of the Prisma client used by
 * {@link RefreshTokenService}. Backed by a plain array so tests can assert over
 * every persisted row directly. Only the members the service touches are
 * implemented; `$transaction` runs its callback against the same instance so
 * writes are visible immediately (sufficient for single-threaded tests).
 */
class InMemoryPrisma {
  /** All persisted rows, exposed so tests can assert final chain state. */
  readonly rows: FakeRow[] = [];

  readonly refreshToken = {
    findUnique: async (args: {
      where: { tokenHash?: string; parentId?: string; id?: string };
    }): Promise<FakeRow | null> => {
      const { tokenHash, parentId, id } = args.where;
      const found = this.rows.find((row) => {
        if (tokenHash !== undefined) return row.tokenHash === tokenHash;
        if (parentId !== undefined) return row.parentId === parentId;
        if (id !== undefined) return row.id === id;
        return false;
      });
      return found ?? null;
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
    }): Promise<FakeRow> => {
      const row: FakeRow = {
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
      return row;
    },

    update: async (args: {
      where: { id: string };
      data: { revoked?: boolean };
    }): Promise<FakeRow> => {
      const row = this.rows.find((r) => r.id === args.where.id);
      if (row === undefined) {
        throw new Error(`No refresh_token row with id ${args.where.id}`);
      }
      if (args.data.revoked !== undefined) row.revoked = args.data.revoked;
      return row;
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

  /** Runs the callback against this same fake, mimicking an interactive tx. */
  async $transaction<T>(fn: (tx: InMemoryPrisma) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

/** Test config: any non-blank secret plus a 7-day refresh lifetime. */
const CONFIG: Config = {
  DATABASE_URL: 'postgres://localhost/test',
  JWT_SECRET: 'test-jwt-secret',
  JWT_EXPIRES_IN: '86400',
  REFRESH_SECRET: 'test-refresh-secret',
  REFRESH_EXPIRES_IN: '604800',
  PORT: 3000,
};

describe('RefreshTokenService reuse-triggered chain revocation (Req 3.3)', () => {
  // Feature: auth, Property 10: Reuse of a rotated token revokes the whole chain
  it('revokes the entire chain, issues no new token, and rejects on reuse of a rotated token', async () => {
    await fc.assert(
      fc.asyncProperty(
        // userId for the chain owner.
        fc.uuid(),
        // How many extra rotations to grow the chain beyond the first (T0->T1).
        fc.integer({ min: 0, max: 4 }),
        async (userId, extraRotations) => {
          const prisma = new InMemoryPrisma();
          const service = new RefreshTokenService(
            prisma as unknown as PrismaService,
            CONFIG,
          );

          // Issue T0 (starts a fresh chain).
          const t0 = await service.issue(userId);
          const chainId = t0.chainId;

          // Rotate T0 -> T1 so T0 now has a successor (is "already rotated").
          let current = await service.rotate(t0.rawToken);

          // Optionally grow the chain further; the reused token (T0) is now
          // several hops behind the live tip.
          for (let i = 0; i < extraRotations; i += 1) {
            current = await service.rotate(current.rawToken);
          }

          const rowCountBeforeReuse = prisma.rows.length;

          // Present the already-rotated T0 again: this is reuse (Req 3.3).
          await expect(service.rotate(t0.rawToken)).rejects.toBeInstanceOf(
            UnauthenticatedException,
          );

          // No new token row was created by the reuse attempt.
          expect(prisma.rows.length).toBe(rowCountBeforeReuse);

          // Every row in the reused token's chain is revoked.
          const chainRows = prisma.rows.filter((r) => r.chainId === chainId);
          expect(chainRows.length).toBe(rowCountBeforeReuse);
          for (const row of chainRows) {
            expect(row.revoked).toBe(true);
          }

          // No successor was created specifically for the reused T0 beyond the
          // original T1 (its single successor is unchanged).
          const successorsOfT0 = prisma.rows.filter(
            (r) => r.parentId === t0.tokenId,
          );
          expect(successorsOfT0.length).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
