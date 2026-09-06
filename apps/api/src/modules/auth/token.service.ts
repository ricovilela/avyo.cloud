import { Inject, Injectable } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';

import { CONFIG } from '../../config/config.module';
import type { Config } from '../../config/env.validation';

/**
 * Claims carried by an Access_Token.
 *
 * - `sub`: the authenticated User UUID (tenant identity).
 * - `iat`: issued-at, seconds since the Unix epoch.
 * - `exp`: expiry, seconds since the Unix epoch.
 *
 * Requirements: 2.2, 11.1
 */
export interface AccessTokenClaims {
  sub: string;
  iat: number;
  exp: number;
}

/**
 * Default Access_Token lifetime in seconds, applied when `JWT_EXPIRES_IN` is
 * absent, empty, or whitespace-only (Req 10.2).
 */
export const DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS = 86400;

/**
 * Resolve the Access_Token lifetime from a raw `JWT_EXPIRES_IN` value.
 *
 * Per Req 10.2 / Property 28:
 * - When `raw` is `undefined`, empty, or whitespace-only, the lifetime is
 *   {@link DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS} (86400 seconds).
 * - Otherwise the configured value is used. A purely numeric value (after
 *   trimming) is returned as a number of seconds; any other non-blank value is
 *   returned verbatim as a duration string (e.g. `"15m"`, `"7d"`) for the JWT
 *   layer to interpret.
 *
 * This is a pure, side-effect-free helper so it can be unit/property tested in
 * isolation.
 *
 * @param raw - The raw `JWT_EXPIRES_IN` environment value.
 * @returns The resolved lifetime: a number of seconds, or a duration string.
 */
export function resolveExpiresIn(raw?: string): number | string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS;
  }

  const trimmed = raw.trim();

  // A purely numeric value is a raw count of seconds.
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  // Otherwise treat it as a duration string understood by the JWT layer.
  return trimmed;
}

/**
 * Signs and verifies HS256 Access_Tokens.
 *
 * Tokens are signed with the symmetric `JWT_SECRET` (Req 10.1) using the HS256
 * algorithm and carry `sub`/`iat`/`exp` claims (Req 2.2). The lifetime is
 * resolved from `JWT_EXPIRES_IN`, defaulting to 86400 seconds when that value
 * is absent/empty/whitespace (Req 10.2).
 *
 * Requirements: 2.2, 10.1, 10.2
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /**
   * Sign an HS256 Access_Token for the given user.
   *
   * @param userId - The User UUID placed in the `sub` claim.
   * @returns The signed `token` and its lifetime in seconds (`expiresInSeconds`),
   *   derived from the actual `exp`/`iat` claims embedded in the token.
   */
  sign(userId: string): { token: string; expiresInSeconds: number } {
    const expiresIn = resolveExpiresIn(this.config.JWT_EXPIRES_IN);

    const token = this.jwtService.sign(
      { sub: userId },
      {
        secret: this.config.JWT_SECRET,
        algorithm: 'HS256',
        // `expiresIn` accepts a number of seconds or a duration string; the
        // resolver guarantees one of those, so narrow it for the JWT typings.
        expiresIn: expiresIn as JwtSignOptions['expiresIn'],
      },
    );

    // Derive the effective lifetime from the token itself so that both numeric
    // seconds and duration strings resolve to a concrete seconds value.
    const decoded = this.jwtService.decode<AccessTokenClaims>(token);
    const expiresInSeconds = decoded.exp - decoded.iat;

    return { token, expiresInSeconds };
  }

  /**
   * Verify an Access_Token's HS256 signature and expiry against `JWT_SECRET`.
   *
   * @param token - The Bearer token to verify.
   * @returns The decoded {@link AccessTokenClaims} when the token is valid.
   * @throws When the signature does not validate or the token has expired
   *   (Req 10.4, 10.5).
   */
  verify(token: string): AccessTokenClaims {
    return this.jwtService.verify<AccessTokenClaims>(token, {
      secret: this.config.JWT_SECRET,
      algorithms: ['HS256'],
    });
  }
}
