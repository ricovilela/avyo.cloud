import fc from 'fast-check';
import { randomUUID } from 'node:crypto';
import type { RefreshToken } from '@prisma/client';

import { RefreshTokenService } from './refresh-token.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { Config } from '../../config/env.validation';

/**
 * Property-based test for Refresh_Token rotation producing fresh, distinct
 * tokens.
 *
 * Validates: Requirements 3.1
 *
 * Property 8 (Refresh rotation produces fresh, distinct tokens): for any valid,
 * unrevoked, unexpired refresh token with no successor, a refresh request
 * returns 200 with a new access_token and a new refresh_token that both differ
 * from the presented token, token_type=bearer, expires_in=86400.
 *
 * Scope note: this spec exercises the rotation SERVICE (`RefreshTokenService`),
 * which is the layer that guarantees Req 3.1's distinct-fresh-token behaviour.
 * The service returns only the refresh side of the exchange, so here we assert
 * what `rotate()` guarantees: it issues a NEW raw refresh token that differs
 * from the presented one, is a non-empty string, and persists a successor in
 * the SAME chain (marking the presented token revoked). The endpoint-level
 * aspects of Req 3.1 — `access_token` presence, `token_type=bearer`, and
 * `expires_in=86400` — are asserted at the `/auth/refresh` e2e level (task 24)
 * and login response property (task 16.2); the 86400 access-token lifetime is
 * covered by Property 28 (`token.service.lifetime.property.spec.ts`).
 */

/**
 * A persisted `refresh_token` row as tracked by the in-memory fake. Mirrors the
 * subset of the Prisma `RefreshToken` model that `RefreshTokenService` reads
 * and writes.
 */
type FakeRow = RefreshToken;

/**
 * Minimal in-memory stand-in for the Prisma client surface that
 * `RefreshTokenService` depends on: `refreshToken.findUnique` (by `tokenHash`
 * or by `parentId`), `refreshToken.create`, `refreshToken.update`,
 * `refreshToken.updateMany`, and a `$transaction` that hands back this same
 * fake as the transactional client.
 *
 * Rows live in a plain array; ids are generated with `crypto.randomUUID()`.
 * Defined locally (not shared) so sibling property specs can each own their
 * own fake without collisions.
 */
class InMemoryRefreshPrisma {
  readonly rows: FakeRow[] = [];

  readonly refreshToken = {
    findUnique: async (args: {
      where: { tokenHash?: string; parentId?: string };
    }): Promise<FakeRow | null> => {
      const { tokenHash, parentId } = args.where;
      if (tokenHash !== undefined) {
        return this.rows.find((r) => r.tokenHash === tokenHash) ?? null;
      }
      if (parentId !== undefined) {
        return this.rows.find((r) => r.parentId === parentId) ?? null;
      }
      return null;
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
      const { data } = args;
      const row: FakeRow = {
        id: randomUUID(),
        userId: data.userId,
        tokenHash: data.tokenHash,
        chainId: data.chainId,
        parentId: data.parentId ?? null,
        revoked: false,
        expiresAt: data.expiresAt,
        userAgent: data.userAgent ?? null,
        os: data.os ?? null,
        browser: data.browser ?? null,
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
        throw new Error(`row ${args.where.id} not found`);
      }
      if (args.data.revoked !== undefined) {
        row.revoked = args.data.revoked;
      }
      return row;
    },

    updateMany: async (args: {
      where: { chainId?: string; tokenHash?: string; userId?: string; revoked?: boolean };
      data: { revoked?: boolean };
    }): Promise<{ count: number }> => {
      const { where, data } = args;
      let count = 0;
      for (const row of this.rows) {
        const matches =
          (where.chainId === undefined || row.chainId === where.chainId) &&
          (where.tokenHash === undefined || row.tokenHash === where.tokenHash) &&
          (where.userId === undefined || row.userId === where.userId) &&
          (where.revoked === undefined || row.revoked === where.revoked);
        if (matches) {
          if (data.revoked !== undefined) {
            row.revoked = data.revoked;
          }
          count += 1;
        }
      }
      return { count };
    },
  };

  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

/** Build a `Config` carrying the secrets/lifetimes the service reads. */
function makeConfig(): Config {
  return {
    DATABASE_URL: 'postgresql://localhost:5432/test',
    JWT_SECRET: 'test-jwt-secret',
    JWT_EXPIRES_IN: '86400',
    REFRESH_SECRET: 'test-refresh-secret',
    REFRESH_EXPIRES_IN: '604800',
    PORT: 3000,
  };
}

/** Arbitrary version-4-shaped user id (a fresh UUID per run). */
function userIdArbitrary(): fc.Arbitrary<string> {
  return fc.constant(null).map(() => randomUUID());
}

/** Arbitrary optional device fingerprint captured at login. */
function deviceArbitrary(): fc.Arbitrary<
  { user_agent: string; os: string; browser: string } | undefined
> {
  const nonEmpty = fc.string({ minLength: 1, maxLength: 32 });
  return fc.option(
    fc.record({ user_agent: nonEmpty, os: nonEmpty, browser: nonEmpty }),
    { nil: undefined },
  );
}

describe('RefreshTokenService.rotate (fresh, distinct tokens)', () => {
  // Feature: auth, Property 8: Refresh rotation produces fresh, distinct tokens
  it('rotates a valid token into a distinct successor in the same chain', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArbitrary(),
        deviceArbitrary(),
        async (userId, device) => {
          const fake = new InMemoryRefreshPrisma();
          const service = new RefreshTokenService(
            fake as unknown as PrismaService,
            makeConfig(),
          );

          // Issue a valid, unrevoked, unexpired token with no successor.
          const issued = await service.issue(userId, device);

          // Rotate the presented token.
          const rotated = await service.rotate(issued.rawToken);

          // New refresh token differs from the presented one and is a
          // non-empty string (Req 3.1: newly generated, distinct).
          expect(typeof rotated.rawToken).toBe('string');
          expect(rotated.rawToken.length).toBeGreaterThan(0);
          expect(rotated.rawToken).not.toBe(issued.rawToken);

          // Successor is persisted in the SAME chain, owned by the same user,
          // and linked to the presented token as its parent (Req 3.2 linkage
          // underpinning the fresh-token guarantee of Req 3.1).
          expect(rotated.chainId).toBe(issued.chainId);
          expect(rotated.userId).toBe(userId);
          expect(rotated.tokenId).not.toBe(issued.tokenId);

          const successor = fake.rows.find((r) => r.id === rotated.tokenId);
          expect(successor).toBeDefined();
          expect(successor?.parentId).toBe(issued.tokenId);
          expect(successor?.revoked).toBe(false);
          expect(successor?.chainId).toBe(issued.chainId);

          // The persisted successor's hash matches the freshly-issued raw
          // token and differs from the presented token's hash.
          expect(successor?.tokenHash).toBe(service.hashToken(rotated.rawToken));
          expect(successor?.tokenHash).not.toBe(
            service.hashToken(issued.rawToken),
          );

          // The presented token was revoked as part of rotation.
          const presented = fake.rows.find((r) => r.id === issued.tokenId);
          expect(presented?.revoked).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
