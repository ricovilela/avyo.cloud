import { HttpCode, Controller, Post, UseGuards } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';

import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { validateEnv, EnvValidationError } from '../../config';
import { RATE_LIMITER } from './ports/rate-limiter';
import { InMemoryRateLimiter } from './ports/fakes/in-memory-rate-limiter';

jest.setTimeout(60_000);

/**
 * Test-only controller used to exercise guard ordering: `JwtAuthGuard` runs
 * first (401 when no/invalid token) and `EmailVerifiedGuard` runs second (403
 * `EMAIL_NOT_VERIFIED` for an authenticated but unverified user). It mirrors how
 * Business_Routes in other modules are protected (Req 5.4, guard ordering).
 */
@Controller('test-guarded')
class TestGuardedController {
  @Post()
  @UseGuards(JwtAuthGuard, EmailVerifiedGuard)
  @HttpCode(200)
  ping(): { ok: boolean } {
    return { ok: true };
  }
}

/** SHA-256 hex digest, matching AuthService's verification/reset token hashing. */
function sha256(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** A fresh opaque token value (URL-safe base64), like the real services emit. */
function rawToken(): string {
  return randomBytes(32).toString('base64url');
}

/** A unique email per invocation so tests never collide on the unique index. */
function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

const VALID_PASSWORD = 'sup3r-secret-pw';
const DEVICE = { user_agent: 'jest', os: 'linux', browser: 'node' };

/** Deletes every auth row in FK-safe order (tokens first, then users). */
async function cleanDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.refreshToken.deleteMany();
  await prisma.emailVerificationToken.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.user.deleteMany();
}

describe('Auth e2e (HTTP)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    await cleanDatabase(prisma);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestGuardedController],
      providers: [PrismaService],
    })
      // Generous limiter so functional flows never trip the rate limit; the
      // dedicated 429 suite below builds its own app with a tiny limit.
      .overrideProvider(RATE_LIMITER)
      .useValue(
        new InMemoryRateLimiter({
          windowSeconds: 60,
          maxPerIp: 100_000,
          maxPerEmail: 100_000,
        }),
      )
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
    await prisma.$disconnect();
  });

  /** Signs up a fresh user and returns its email/password/id. */
  async function signup(
    email = uniqueEmail(),
  ): Promise<{ email: string; id: string }> {
    const res = await request(server)
      .post('/auth/signup')
      .send({
        name: 'E2E User',
        email,
        password: VALID_PASSWORD,
        captcha0: 'a',
        captcha1: 'b',
      })
      .expect(201);
    return { email, id: res.body.id as string };
  }

  /** Logs a user in and returns the issued token pair. */
  async function login(
    email: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const res = await request(server)
      .post('/auth/login')
      .send({
        email,
        password: VALID_PASSWORD,
        captcha0: 'a',
        captcha1: 'b',
        device: DEVICE,
      })
      .expect(200);
    return {
      access_token: res.body.access_token as string,
      refresh_token: res.body.refresh_token as string,
    };
  }

  describe('POST /auth/signup', () => {
    it('creates an account and returns a snake_case body without credentials (Req 1.1, 12.3)', async () => {
      const email = uniqueEmail();
      const res = await request(server)
        .post('/auth/signup')
        .send({
          name: 'Jane',
          email,
          password: VALID_PASSWORD,
          captcha0: 'a',
          captcha1: 'b',
        })
        .expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        email,
        email_verified_at: null,
      });
      // No credential material leaks, at any key.
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain('password');
      expect(serialized).not.toContain('hash');
      // snake_case keys only.
      expect(Object.keys(res.body)).toEqual(['id', 'email', 'email_verified_at']);
    });
  });

  describe('POST /auth/login', () => {
    it('issues a bearer token pair with expires_in 86400 (Req 2.1)', async () => {
      const { email } = await signup();
      const res = await request(server)
        .post('/auth/login')
        .send({
          email,
          password: VALID_PASSWORD,
          captcha0: 'a',
          captcha1: 'b',
          device: DEVICE,
        })
        .expect(200);

      expect(res.body).toEqual({
        access_token: expect.any(String),
        refresh_token: expect.any(String),
        token_type: 'bearer',
        expires_in: 86400,
      });
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh token, returning a fresh, distinct one (Req 3.1)', async () => {
      const { email } = await signup();
      const { refresh_token } = await login(email);

      const res = await request(server)
        .post('/auth/refresh')
        .send({ refresh_token })
        .expect(200);

      expect(res.body).toEqual({
        access_token: expect.any(String),
        refresh_token: expect.any(String),
        token_type: 'bearer',
        expires_in: 86400,
      });
      expect(res.body.refresh_token).not.toEqual(refresh_token);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the session and returns 204 with an empty body (Req 4.1)', async () => {
      const { email } = await signup();
      const { access_token, refresh_token } = await login(email);

      const res = await request(server)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${access_token}`)
        .send({ refresh_token })
        .expect(204);

      expect(res.body).toEqual({});
      expect(res.text).toBe('');

      // The revoked refresh token can no longer be rotated (Req 4.3).
      await request(server)
        .post('/auth/refresh')
        .send({ refresh_token })
        .expect(401);
    });

    it('rejects an unauthenticated logout with 401 UNAUTHENTICATED (Req 4.2)', async () => {
      const res = await request(server)
        .post('/auth/logout')
        .send({ refresh_token: 'whatever' })
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('POST /auth/verify-email', () => {
    it('rejects an unknown token with 422 and a snake_case error envelope (Req 5.1, 12.3)', async () => {
      const res = await request(server)
        .post('/auth/verify-email')
        .send({ token: rawToken() })
        .expect(422);

      expect(res.body).toEqual({
        error: {
          code: 'UNPROCESSABLE',
          message: expect.any(String),
          details: [],
        },
      });
    });

    it('verifies a valid token (inserted directly) with 204 (Req 5.1)', async () => {
      const { id } = await signup();
      const token = rawToken();
      await prisma.emailVerificationToken.create({
        data: {
          userId: id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });

      const res = await request(server)
        .post('/auth/verify-email')
        .send({ token })
        .expect(204);
      expect(res.text).toBe('');

      const user = await prisma.user.findUnique({ where: { id } });
      expect(user?.emailVerifiedAt).not.toBeNull();
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('returns 204 empty for an existing email (Req 6.1)', async () => {
      const { email } = await signup();
      const res = await request(server)
        .post('/auth/forgot-password')
        .send({ email })
        .expect(204);
      expect(res.text).toBe('');
    });

    it('returns 204 empty for a non-existing email (Req 6.1)', async () => {
      const res = await request(server)
        .post('/auth/forgot-password')
        .send({ email: uniqueEmail('ghost') })
        .expect(204);
      expect(res.text).toBe('');
    });
  });

  describe('POST /auth/reset-password', () => {
    it('rejects an unknown token with 422 (Req 7.1)', async () => {
      const res = await request(server)
        .post('/auth/reset-password')
        .send({ token: rawToken(), password: 'brand-new-pass' })
        .expect(422);
      expect(res.body.error.code).toBe('UNPROCESSABLE');
    });

    it('resets the password for a valid token (inserted directly) with 204 (Req 7.1)', async () => {
      const { id } = await signup();
      const token = rawToken();
      await prisma.passwordResetToken.create({
        data: {
          userId: id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });

      const res = await request(server)
        .post('/auth/reset-password')
        .send({ token, password: 'brand-new-pass-1' })
        .expect(204);
      expect(res.text).toBe('');

      // The token is now consumed: a second use is rejected (Req 7.2).
      await request(server)
        .post('/auth/reset-password')
        .send({ token, password: 'brand-new-pass-2' })
        .expect(422);
    });
  });

  describe('POST /auth/me', () => {
    it('returns a snake_case { user, menu } for a valid token (Req 8.1, 12.3)', async () => {
      const { email, id } = await signup();
      const { access_token } = await login(email);

      const res = await request(server)
        .post('/auth/me')
        .set('Authorization', `Bearer ${access_token}`)
        .expect(200);

      expect(res.body.user).toEqual({
        id,
        name: 'E2E User',
        email,
        plan: 'ctrlsale',
        email_verified_at: null,
      });
      expect(Array.isArray(res.body.menu)).toBe(true);
      expect(res.body.menu.length).toBeGreaterThan(0);
      for (const entry of res.body.menu) {
        expect(Object.keys(entry).sort()).toEqual(
          ['icon', 'key', 'label', 'route'].sort(),
        );
        expect(entry.key).toBeTruthy();
      }
    });

    it('rejects a missing token with 401 UNAUTHENTICATED and no profile (Req 8.3)', async () => {
      const res = await request(server).post('/auth/me').expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.body.user).toBeUndefined();
      expect(res.body.menu).toBeUndefined();
    });
  });

  describe('Guard ordering (JwtAuthGuard then EmailVerifiedGuard)', () => {
    it('returns 401 when no token is present (JwtAuthGuard runs first)', async () => {
      const res = await request(server).post('/test-guarded').expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 403 EMAIL_NOT_VERIFIED for an authenticated but unverified user (EmailVerifiedGuard runs second)', async () => {
      const { email } = await signup();
      const { access_token } = await login(email);

      const res = await request(server)
        .post('/test-guarded')
        .set('Authorization', `Bearer ${access_token}`)
        .expect(403);
      expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    });
  });

  describe('Env validation reports every offender (Req 10.6)', () => {
    it('names both JWT_SECRET and REFRESH_SECRET when both are missing', () => {
      const env = {
        DATABASE_URL: 'postgresql://user:password@localhost:5432/avyo_dev',
        REFRESH_EXPIRES_IN: '7d',
        PORT: '3000',
        // JWT_SECRET and REFRESH_SECRET deliberately omitted.
      };
      let error: EnvValidationError | undefined;
      try {
        validateEnv(env);
      } catch (e) {
        error = e as EnvValidationError;
      }
      expect(error).toBeInstanceOf(EnvValidationError);
      expect(error?.variables).toEqual(
        expect.arrayContaining(['JWT_SECRET', 'REFRESH_SECRET']),
      );
    });
  });
});

describe('Auth e2e (rate limiting)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    await cleanDatabase(prisma);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RATE_LIMITER)
      .useValue(
        new InMemoryRateLimiter({
          windowSeconds: 60,
          maxPerIp: 2,
          maxPerEmail: 2,
        }),
      )
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
    await prisma.$disconnect();
  });

  it('rejects with 429 RATE_LIMITED and a Retry-After header once the limit is reached (Req 9.2)', async () => {
    const email = uniqueEmail('rl');
    const body = {
      email,
      password: VALID_PASSWORD,
      captcha0: 'a',
      captcha1: 'b',
      device: DEVICE,
    };

    // First two hits are within the limit (they fail auth with 401 since no
    // such user exists, but they are forwarded for processing).
    await request(server).post('/auth/login').send(body);
    await request(server).post('/auth/login').send(body);

    // The third hit trips the limiter before the handler runs.
    const res = await request(server).post('/auth/login').send(body).expect(429);

    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBeDefined();
    // Whole seconds.
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(Number(res.headers['retry-after']))).toBe(true);
  });
});
