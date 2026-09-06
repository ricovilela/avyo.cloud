import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient, RefreshToken } from '@prisma/client';

import { CONFIG } from '../../config/config.module';
import type { Config } from '../../config/env.validation';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UnauthenticatedException } from '../../common/filters/app.exception';

/**
 * Device fingerprint captured at login and carried across a Refresh_Token_Chain
 * for auditing (Req 2.4). Field names are snake_case to match the inbound DTO.
 */
export interface DeviceFingerprint {
  user_agent: string;
  os: string;
  browser: string;
}

/**
 * Result of issuing or rotating a Refresh_Token.
 *
 * `rawToken` is the opaque high-entropy value handed back to the caller (and
 * ultimately the client); it is never persisted. `tokenId`/`chainId`/`userId`
 * identify the freshly-persisted row so the caller can mint a matching
 * Access_Token and correlate the session.
 */
export interface IssuedRefreshToken {
  rawToken: string;
  tokenId: string;
  chainId: string;
  userId: string;
}

/**
 * Number of random bytes backing an opaque Refresh_Token (256 bits of entropy).
 */
export const REFRESH_TOKEN_BYTES = 32;

/**
 * Derive the persisted `token_hash` for a raw Refresh_Token.
 *
 * Uses HMAC-SHA256 keyed with `REFRESH_SECRET` (Req 10.3). Only this hash is
 * ever stored, so a database read cannot reconstruct a usable token, and a
 * presented token is integrity-bound to the secret before any lookup.
 *
 * Exposed as a pure function so it can be unit/property tested in isolation.
 *
 * @param secret - The `REFRESH_SECRET` HMAC key.
 * @param rawToken - The opaque token value presented by / issued to the client.
 * @returns The hex-encoded HMAC-SHA256 digest.
 */
export function hashRefreshToken(secret: string, rawToken: string): string {
  return createHmac('sha256', secret).update(rawToken).digest('hex');
}

/**
 * Parse a `REFRESH_EXPIRES_IN` value into a whole number of seconds.
 *
 * Accepts either a raw count of seconds (e.g. `"604800"`) or a duration string
 * with a single unit suffix: `s` (seconds), `m` (minutes), `h` (hours),
 * `d` (days), or `w` (weeks) — e.g. `"7d"`, `"12h"`, `"30m"` (Req 10.3).
 *
 * Pure and side-effect-free for isolated testing.
 *
 * @param raw - The configured `REFRESH_EXPIRES_IN` value.
 * @returns The lifetime in seconds.
 * @throws When the value is not a positive integer count of seconds nor a
 *   recognised `<number><unit>` duration string.
 */
export function parseRefreshExpiresInSeconds(raw: string): number {
  const trimmed = raw.trim();

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const match = /^(\d+)\s*(s|m|h|d|w)$/.exec(trimmed);
  if (!match) {
    throw new Error(
      `Invalid REFRESH_EXPIRES_IN value "${raw}": expected seconds or a <number><unit> duration (s|m|h|d|w).`,
    );
  }

  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd' | 'w';
  const unitSeconds: Record<'s' | 'm' | 'h' | 'd' | 'w', number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
    w: 7 * 24 * 60 * 60,
  };

  return amount * unitSeconds[unit];
}

/**
 * The subset of the Prisma client that this service depends on.
 *
 * Declaring the dependency structurally keeps all database access behind a
 * small, well-known surface so tests can substitute an in-memory fake that
 * implements only these members.
 */
export type RefreshTokenPrisma = Pick<PrismaClient, 'refreshToken' | '$transaction'>;

/**
 * Issues, rotates, and revokes opaque Refresh_Tokens with reuse detection and
 * chain-family revocation.
 *
 * Design: see "Refresh token model and rotation" in the auth design document.
 * Tokens are opaque high-entropy strings; only their HMAC-SHA256 hash
 * (keyed with `REFRESH_SECRET`) is persisted. Each login starts a new
 * Refresh_Token_Chain (`chain_id`); rotation links a presented token to its
 * successor via `parent_id`. Presenting an already-rotated (or
 * revoked-with-successor) token is treated as reuse and revokes the entire
 * chain.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 10.3
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /**
   * Compute the persisted `token_hash` for a raw Refresh_Token using
   * `REFRESH_SECRET` (Req 10.3).
   *
   * @param rawToken - The opaque token value.
   * @returns The hex-encoded HMAC-SHA256 digest.
   */
  hashToken(rawToken: string): string {
    return hashRefreshToken(this.config.REFRESH_SECRET, rawToken);
  }

  /**
   * Generate a new opaque, high-entropy Refresh_Token value.
   *
   * @returns A URL-safe base64 string carrying {@link REFRESH_TOKEN_BYTES} bytes
   *   of cryptographic randomness.
   */
  private generateRawToken(): string {
    return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  }

  /**
   * Compute the absolute expiry instant for a newly-issued Refresh_Token from
   * `REFRESH_EXPIRES_IN` (Req 10.3).
   *
   * @param from - The reference "now" instant.
   * @returns The `expires_at` timestamp.
   */
  private computeExpiresAt(from: Date): Date {
    const seconds = parseRefreshExpiresInSeconds(this.config.REFRESH_EXPIRES_IN);
    return new Date(from.getTime() + seconds * 1000);
  }

  /**
   * Determine whether a token already has a successor (i.e. has been rotated).
   *
   * `parent_id` is unique, so a successor is looked up by that column.
   *
   * @param tokenId - The presented token's id.
   * @returns `true` when a successor row exists in the chain.
   */
  private async hasSuccessor(tokenId: string): Promise<boolean> {
    const successor = await this.prisma.refreshToken.findUnique({
      where: { parentId: tokenId },
    });
    return successor !== null;
  }

  /**
   * Revoke every Refresh_Token belonging to a chain (reuse mitigation, Req 3.3).
   *
   * @param chainId - The `chain_id` of the family to revoke.
   */
  private async revokeChain(chainId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { chainId },
      data: { revoked: true },
    });
  }

  /**
   * Issue a brand-new Refresh_Token at login, starting a fresh chain.
   *
   * Generates an opaque token, persists only its hash, records the device
   * fingerprint for auditing (Req 2.4), and sets `expires_at` from
   * `REFRESH_EXPIRES_IN` (Req 10.3).
   *
   * @param userId - The owning User's UUID.
   * @param device - Optional device fingerprint captured at login.
   * @returns The raw token plus identifiers for the persisted row.
   */
  async issue(
    userId: string,
    device?: DeviceFingerprint,
  ): Promise<IssuedRefreshToken> {
    const rawToken = this.generateRawToken();
    const tokenHash = this.hashToken(rawToken);
    const chainId = randomUUID();
    const expiresAt = this.computeExpiresAt(new Date());

    const created = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        chainId,
        expiresAt,
        userAgent: device?.user_agent ?? null,
        os: device?.os ?? null,
        browser: device?.browser ?? null,
      },
    });

    return { rawToken, tokenId: created.id, chainId: created.chainId, userId };
  }

  /**
   * Rotate a presented Refresh_Token into a fresh successor.
   *
   * Implements the rotation algorithm from the design (steps 1–6):
   * 1. Compute the token hash.
   * 2. Look up the row by hash; a miss is `UNAUTHENTICATED` with no state change
   *    (Req 3.4).
   * 3. If the row is revoked or expired: when a successor exists this is reuse —
   *    revoke the whole chain (Req 3.3); otherwise it is plainly invalid and
   *    other chains are left untouched (Req 3.4). Either way, `UNAUTHENTICATED`.
   * 4. If the row is valid but already has a successor, this is reuse — revoke
   *    the whole chain and reject (Req 3.3).
   * 5. Otherwise, in a single transaction, revoke the presented token and insert
   *    its successor in the same chain, then return the new raw token (Req 3.1,
   *    3.2). The caller mints the matching Access_Token.
   *
   * @param rawToken - The opaque Refresh_Token presented by the client.
   * @returns The freshly-issued successor token and its identifiers.
   * @throws {UnauthenticatedException} for unknown, revoked, expired, or reused
   *   tokens.
   */
  async rotate(rawToken: string): Promise<IssuedRefreshToken> {
    const tokenHash = this.hashToken(rawToken);

    const presented = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (presented === null) {
      // Unknown token: no state change (Req 3.4).
      throw new UnauthenticatedException();
    }

    const now = new Date();
    const isRevokedOrExpired =
      presented.revoked || presented.expiresAt.getTime() <= now.getTime();

    if (isRevokedOrExpired) {
      if (await this.hasSuccessor(presented.id)) {
        // Reuse of a rotated-then-invalidated token: revoke the family (Req 3.3).
        await this.revokeChain(presented.chainId);
      }
      // Plainly revoked/expired tokens leave other chains unchanged (Req 3.4).
      throw new UnauthenticatedException();
    }

    if (await this.hasSuccessor(presented.id)) {
      // Valid-looking token that was already rotated: reuse (Req 3.3).
      await this.revokeChain(presented.chainId);
      throw new UnauthenticatedException();
    }

    // Valid, unrevoked, unexpired, no successor: rotate (Req 3.1, 3.2).
    const newRawToken = this.generateRawToken();
    const newTokenHash = this.hashToken(newRawToken);
    const expiresAt = this.computeExpiresAt(now);

    const successor = await this.prisma.$transaction(
      async (tx): Promise<RefreshToken> => {
        await tx.refreshToken.update({
          where: { id: presented.id },
          data: { revoked: true },
        });

        return tx.refreshToken.create({
          data: {
            userId: presented.userId,
            tokenHash: newTokenHash,
            chainId: presented.chainId,
            parentId: presented.id,
            expiresAt,
            userAgent: presented.userAgent,
            os: presented.os,
            browser: presented.browser,
          },
        });
      },
    );

    return {
      rawToken: newRawToken,
      tokenId: successor.id,
      chainId: successor.chainId,
      userId: successor.userId,
    };
  }

  /**
   * Revoke the single Refresh_Token backing the current session (logout, Req
   * 4.1).
   *
   * Idempotent: revoking an already-revoked or unknown token changes no
   * additional state and does not throw (Req 4.4).
   *
   * @param rawToken - The opaque Refresh_Token bound to the session.
   */
  async revokeSession(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { revoked: true },
    });
  }

  /**
   * Revoke every active Refresh_Token for a User (password reset, Req 7.3).
   *
   * @param userId - The owning User's UUID.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
  }
}
