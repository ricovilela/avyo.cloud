// Feature: auth, Property 5: Login issues well-formed tokens
import fc from 'fast-check';
import { JwtService } from '@nestjs/jwt';

import { AuthService, LOGIN_EXPIRES_IN_SECONDS } from './auth.service';
import { TokenService } from './token.service';
import type { Config } from '../../config/env.validation';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { Argon2PasswordHasher } from './password.hasher';
import type { CaptchaVerifier } from './ports/captcha-verifier';
import type { Mailer } from './ports/mailer';
import type { RefreshTokenService } from './refresh-token.service';
import type { LoginDto } from './dto/login.dto';

/**
 * Feature: auth, Property 5 — Login issues well-formed tokens.
 *
 * Validates: Requirements 2.1, 2.2, 2.8
 *
 * For any credentials matching an existing verified or unverified user with a
 * valid captcha and a complete device object, `login` responds with a body
 * carrying `access_token`, `refresh_token`, `token_type` `bearer`, and
 * `expires_in` 86400 (Req 2.1). The access token is a genuine HS256-signed JWT
 * whose signature verifies against `JWT_SECRET` and whose `sub` claim is the
 * user id (Req 2.2). Both verified and unverified users receive tokens
 * (Req 2.8).
 *
 * The service is assembled from local fakes plus a REAL {@link TokenService}
 * (backed by a real `@nestjs/jwt` `JwtService`) so the emitted access token is
 * genuinely HS256-signed and can be verified with the same secret.
 */

const KNOWN_SECRET = 'login-property-jwt-secret';

/** Build a {@link Config} with a known secret and a fixed 86400s lifetime. */
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

/** Decode the JOSE header of a compact JWT (first `.`-separated segment). */
function decodeHeader(token: string): Record<string, unknown> {
  const header = token.split('.')[0] ?? '';
  const json = Buffer.from(header, 'base64url').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

describe('AuthService.login property: login issues well-formed tokens (Property 5)', () => {
  /** A non-empty string for password/captcha/device fields. */
  const nonEmptyString = fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((s) => s.trim().length > 0);

  const deviceArb = fc.record({
    user_agent: nonEmptyString,
    os: nonEmptyString,
    browser: nonEmptyString,
  });

  it('responds with a bearer pair and a real HS256 access token for verified and unverified users', async () => {
    // A real TokenService so the access token is genuinely HS256-signed and can
    // be verified with the same secret.
    const tokenService = new TokenService(new JwtService({}), makeConfig());

    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.emailAddress(),
        nonEmptyString,
        nonEmptyString,
        nonEmptyString,
        deviceArb,
        // emailVerifiedAt: null (unverified) or a Date (verified) — both must
        // issue tokens (Req 2.8).
        fc.option(fc.date({ min: new Date(0) }), { nil: null }),
        async (
          userId,
          email,
          password,
          captcha0,
          captcha1,
          device,
          emailVerifiedAt,
        ) => {
          // Fake Prisma: the presented email resolves to our generated user row.
          const prisma = {
            user: {
              findUnique: () =>
                Promise.resolve({
                  id: userId,
                  email: email.trim().toLowerCase(),
                  passwordHash: 'stored',
                  emailVerifiedAt,
                }),
            },
          } as unknown as PrismaService;

          // Captcha always valid so login proceeds.
          const captcha = {
            verify: () => Promise.resolve(true),
          } as unknown as CaptchaVerifier;

          // Password always matches so login proceeds.
          const hasher = {
            hash: () => Promise.resolve('stored'),
            verify: () => Promise.resolve(true),
          } as unknown as Argon2PasswordHasher;

          // A refresh token is only required to be a non-empty string here; the
          // rotation/distinctness behaviour is covered by other properties.
          const refreshTokenService = {
            issue: (uid: string) =>
              Promise.resolve({
                rawToken: `refresh-${uid}`,
                tokenId: 't',
                chainId: 'c',
                userId: uid,
              }),
          } as unknown as RefreshTokenService;

          const service = new AuthService(
            prisma,
            hasher,
            captcha,
            {} as unknown as Mailer,
            tokenService,
            refreshTokenService,
          );

          const dto: LoginDto = {
            email,
            password,
            captcha0,
            captcha1,
            device,
          };

          const result = await service.login(dto);

          // Token envelope shape (Req 2.1).
          expect(result.token_type).toBe('bearer');
          expect(result.expires_in).toBe(86400);
          expect(result.expires_in).toBe(LOGIN_EXPIRES_IN_SECONDS);

          // Both tokens are present, non-empty strings.
          expect(typeof result.access_token).toBe('string');
          expect(result.access_token.length).toBeGreaterThan(0);
          expect(typeof result.refresh_token).toBe('string');
          expect(result.refresh_token.length).toBeGreaterThan(0);

          // The access token is a genuine HS256 JWT (Req 2.2): its header
          // declares alg HS256...
          const header = decodeHeader(result.access_token);
          expect(header.alg).toBe('HS256');

          // ...and its signature verifies against the same JWT_SECRET, yielding
          // a `sub` equal to the user id.
          const claims = tokenService.verify(result.access_token);
          expect(claims.sub).toBe(userId);

          // Both verified and unverified users receive tokens (Req 2.8): the
          // assertions above hold regardless of emailVerifiedAt.
        },
      ),
      { numRuns: 100 },
    );
  });
});
