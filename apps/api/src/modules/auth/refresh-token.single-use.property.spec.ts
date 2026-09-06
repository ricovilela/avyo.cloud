// Feature: auth, Property 9: Rotation invalidates the presented token (round-trip / single-use)
import { randomUUID } from 'node:crypto';
import fc from 'fast-check';

import type { Config } from '../../config/env.validation';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { UnauthenticatedException } from '../../common/filters/app.exception';
import { RefreshTokenService } from './refresh-token.service';

/**
 * Minimal shape of a persisted `refresh_token` row exercised by these tests.
 * Mirrors the Prisma `RefreshToken` model fields the service reads/writes.
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
 * In-memory Prisma fake scoped to THIS spec (defined locally to avoid colliding
 * with sibling property specs authored in parallel). Implements only the
 * surface `RefreshTokenService` depends on: `refreshToken.findUnique`
 * (by `tokenHash` or `parentId`), `create`, `update`, `updateMany`, and a
 * `$transaction(async tx => ...)` that runs against the same fake.
 */
function createPrismaFake(): PrismaService {
  const rows: FakeRow[] = [];

  const refreshToken = {
    findUnique(args: {
      where: { tokenHash?: string; parentId?: string };
    }): Promise<FakeRow | null> {
      const { tokenHash, parentId } = args.where;
      const found = rows.find((row) => {
        if (tokenHash !== undefined) return row.tokenHash === tokenHash;
        if (parentId !== undefined) return row.parentId === parentId;
        return false;
      });
      return Promise.resolve(found ?? null);
    },

    create(args: {
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
    }): Promise<FakeRow> {
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
      rows.push(row);
      return Promise.resolve(row);
    },

    update(args: {
      where: { id: string };
      data: { revoked?: boolean };
    }): Promise<FakeRow> {
      const row = rows.find((r) => r.id === args.where.id);
      if (row === undefined) {
        return Promise.reject(new Error('Record to update not found.'));
      }
      if (args.data.revoked !== undefined) row.revoked = args.data.revoked;
      return Promise.resolve(row);
    },

    updateMany(args: {
      where: { chainId?: string; tokenHash?: string; userId?: string; revoked?: boolean };
      data: { revoked?: boolean };
    }): Promise<{ count: number }> {
      const { chainId, tokenHash, userId, revoked } = args.where;
      let count = 0;
      for (const row of rows) {
        if (chainId !== undefined && row.chainId !== chainId) continue;
        if (tokenHash !== undefined && row.tokenHash !== tokenHash) continue;
        if (userId !== undefined && row.userId !== userId) continue;
        if (revoked !== undefined && row.revoked !== revoked) continue;
        if (args.data.revoked !== undefined) row.revoked = args.data.revoked;
        count += 1;
      }
      return Promise.resolve({ count });
    },
  };

  const fake: { refreshToken: typeof refreshToken; $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> } = {
    refreshToken,
    $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(fake);
    },
  };

  return fake as unknown as PrismaService;
}

const config: Config = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_SECRET: 'jwt-secret-for-tests',
  JWT_EXPIRES_IN: '900',
  REFRESH_SECRET: 'refresh-secret-for-tests',
  REFRESH_EXPIRES_IN: '604800',
  PORT: 3000,
};

describe('RefreshTokenService — Property 9: single-use invalidation of the presented token', () => {
  // Property 9: Rotation invalidates the presented token (round-trip / single-use)
  // Validates: Requirements 3.2
  //
  // For any successful refresh, the presented refresh token is revoked and
  // cannot be used again: an immediately following refresh with the same
  // presented token does not succeed.
  it('rejects a second rotation of the same presented token', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.option(
          fc.record({
            user_agent: fc.string(),
            os: fc.string(),
            browser: fc.string(),
          }),
          { nil: undefined },
        ),
        async (userId, device) => {
          const prisma = createPrismaFake();
          const service = new RefreshTokenService(prisma, config);

          const { rawToken: original } = await service.issue(userId, device);

          // First rotation must succeed.
          await service.rotate(original);

          // Presenting the same original token again must not succeed.
          await expect(service.rotate(original)).rejects.toBeInstanceOf(
            UnauthenticatedException,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
