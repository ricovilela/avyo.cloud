import { JwtService } from '@nestjs/jwt';

import type { Config } from '../../config/env.validation';
import { AccessTokenClaims, TokenService } from './token.service';

/**
 * Unit tests for {@link TokenService} sign/verify.
 *
 * These exercise the real (non-mocked) `@nestjs/jwt` `JwtService` so the tests
 * validate genuine HS256 signing/verification behaviour.
 *
 * Requirements: 10.1, 10.4, 10.5
 */

const KNOWN_SECRET = 'test-jwt-secret-value';
const OTHER_SECRET = 'a-different-jwt-secret';
const USER_ID = '11111111-2222-3333-4444-555555555555';

/** Build a {@link Config} with a known secret and a fixed 86400s lifetime. */
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    DATABASE_URL: 'postgres://localhost:5432/test',
    JWT_SECRET: KNOWN_SECRET,
    JWT_EXPIRES_IN: '86400',
    REFRESH_SECRET: 'refresh-secret',
    REFRESH_EXPIRES_IN: '604800',
    PORT: 3000,
    ...overrides,
  };
}

/** Decode the JOSE header of a compact JWT (first `.`-separated segment). */
function decodeHeader(token: string): Record<string, unknown> {
  const header = token.split('.')[0] ?? '';
  const json = Buffer.from(header, 'base64url').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

describe('TokenService (Req 10.1, 10.4, 10.5)', () => {
  const jwtService = new JwtService({});

  describe('sign / verify round-trip (Req 10.1)', () => {
    const service = new TokenService(jwtService, makeConfig());

    it('verify(sign(userId)) returns claims with sub === userId', () => {
      const { token } = service.sign(USER_ID);

      const claims: AccessTokenClaims = service.verify(token);

      expect(claims.sub).toBe(USER_ID);
    });

    it('embeds a lifetime of exp - iat === expiresInSeconds (86400 for "86400")', () => {
      const { token, expiresInSeconds } = service.sign(USER_ID);

      const claims = service.verify(token);

      expect(expiresInSeconds).toBe(86400);
      expect(claims.exp - claims.iat).toBe(86400);
    });

    it('signs with the HS256 algorithm (Req 10.1)', () => {
      const { token } = service.sign(USER_ID);

      const header = decodeHeader(token);

      expect(header.alg).toBe('HS256');
      expect(header.typ).toBe('JWT');
    });
  });

  describe('rejects invalid signatures (Req 10.4)', () => {
    const service = new TokenService(jwtService, makeConfig());

    it('throws when the signature segment is tampered', () => {
      const { token } = service.sign(USER_ID);
      const [header = '', payload = '', signature = ''] = token.split('.');

      // Flip the last character of the signature to a different base64url char.
      const lastChar = signature.slice(-1);
      const replacement = lastChar === 'A' ? 'B' : 'A';
      const tampered = `${header}.${payload}.${signature.slice(0, -1)}${replacement}`;

      expect(() => service.verify(tampered)).toThrow();
    });

    it('throws for a token signed with a different secret', () => {
      const foreignToken = jwtService.sign(
        { sub: USER_ID },
        { secret: OTHER_SECRET, algorithm: 'HS256', expiresIn: '86400s' },
      );

      expect(() => service.verify(foreignToken)).toThrow();
    });
  });

  describe('rejects expired tokens (Req 10.5)', () => {
    const service = new TokenService(jwtService, makeConfig());

    it('throws when verifying an already-expired token', () => {
      // Craft a token that expired 10 seconds ago, signed with the known secret
      // so that only the expiry (not the signature) causes the rejection.
      const expiredToken = jwtService.sign(
        { sub: USER_ID },
        { secret: KNOWN_SECRET, algorithm: 'HS256', expiresIn: '-10s' },
      );

      expect(() => service.verify(expiredToken)).toThrow();
    });
  });
});
