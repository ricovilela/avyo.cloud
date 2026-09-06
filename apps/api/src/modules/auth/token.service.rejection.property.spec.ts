import fc from 'fast-check';
import { JwtService } from '@nestjs/jwt';

import type { Config } from '../../config/env.validation';
import { TokenService } from './token.service';

/**
 * Property-based test for rejection of invalid/expired Access_Tokens.
 *
 * Validates: Requirements 10.4, 10.5
 *
 * Property 29 (Invalid or expired access tokens are rejected): for any access
 * token whose HS256 signature does not validate against `JWT_SECRET`, or whose
 * expiry has already passed, {@link TokenService.verify} — the signature/expiry
 * enforcement point behind the JWT strategy and guard — throws, so the request
 * is rejected `401 UNAUTHENTICATED` and no authenticated session is established.
 */

/** The secret the TokenService under test verifies against. */
const KNOWN_SECRET = 'known-jwt-secret-for-property-29';

/**
 * Build a {@link Config} whose `JWT_SECRET` is the known secret. Signing is
 * performed independently in the test, so `JWT_EXPIRES_IN` is irrelevant here.
 */
function makeConfig(): Config {
  return {
    DATABASE_URL: 'postgres://localhost:5432/test',
    JWT_SECRET: KNOWN_SECRET,
    JWT_EXPIRES_IN: '86400',
    REFRESH_SECRET: 'refresh-secret',
    REFRESH_EXPIRES_IN: '604800',
    PORT: 3000,
  };
}

/** A bare `JwtService` used to sign the (bad) tokens the service must reject. */
const signer = new JwtService({});

/** Arbitrary UUID-shaped `sub` claim values. */
const subArbitrary = fc.uuid();

/**
 * Family (a): tokens signed with a secret DIFFERENT from `KNOWN_SECRET`, so the
 * HS256 signature must fail to validate (Req 10.4). The other secret is
 * generated freely and constrained to differ from the known secret.
 */
const wrongSignatureCase = fc
  .record({
    sub: subArbitrary,
    otherSecret: fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s !== KNOWN_SECRET),
  })
  .map(({ sub, otherSecret }) => ({
    kind: 'wrong-signature' as const,
    token: signer.sign(
      { sub },
      { secret: otherSecret, algorithm: 'HS256', expiresIn: '86400s' },
    ),
  }));

/**
 * Family (b): tokens signed with the CORRECT secret but already expired, so
 * only the expiry (not the signature) causes rejection (Req 10.5). The negative
 * offset is generated to guarantee `exp` is strictly in the past.
 */
const expiredCase = fc
  .record({
    sub: subArbitrary,
    agoSeconds: fc.integer({ min: 1, max: 1_000_000 }),
  })
  .map(({ sub, agoSeconds }) => ({
    kind: 'expired' as const,
    token: signer.sign(
      { sub },
      { secret: KNOWN_SECRET, algorithm: 'HS256', expiresIn: -agoSeconds },
    ),
  }));

/**
 * Family (c): a validly-signed, unexpired token whose signature segment is then
 * mutated, plus arbitrary non-JWT garbage strings — both must be rejected as
 * malformed/invalid-signature (Req 10.4).
 */
const tamperedCase = fc
  .record({ sub: subArbitrary })
  .map(({ sub }) => {
    const valid = signer.sign(
      { sub },
      { secret: KNOWN_SECRET, algorithm: 'HS256', expiresIn: '86400s' },
    );
    const [header = '', payload = '', signature = ''] = valid.split('.');
    const last = signature.slice(-1);
    const replacement = last === 'A' ? 'B' : 'A';
    const tampered = `${header}.${payload}.${signature.slice(0, -1)}${replacement}`;
    return { kind: 'tampered' as const, token: tampered };
  });

/** Arbitrary garbage strings that are not well-formed JWTs. */
const garbageCase = fc
  .string({ maxLength: 60 })
  .filter((s) => s.split('.').length !== 3)
  .map((token) => ({ kind: 'garbage' as const, token }));

describe('TokenService.verify (invalid/expired access-token rejection)', () => {
  const service = new TokenService(signer, makeConfig());

  // Feature: auth, Property 29: Invalid or expired access tokens are rejected
  it('rejects every token with a bad signature, past expiry, or malformed shape', () => {
    fc.assert(
      fc.property(
        fc.oneof(wrongSignatureCase, expiredCase, tamperedCase, garbageCase),
        ({ token }) => {
          // In every family the token is invalid; verify MUST throw and thus no
          // authenticated session can be established (401 UNAUTHENTICATED).
          expect(() => service.verify(token)).toThrow();
        },
      ),
      { numRuns: 200 },
    );
  });
});
