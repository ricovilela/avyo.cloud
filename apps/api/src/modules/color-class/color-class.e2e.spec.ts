import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { AppModule } from '../../app.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RATE_LIMITER } from '../auth/ports/rate-limiter';
import { InMemoryRateLimiter } from '../auth/ports/fakes/in-memory-rate-limiter';

jest.setTimeout(60_000);

/**
 * End-to-end HTTP tests for `GET /color-class`, exercising the full request
 * pipeline (guards → controller → service → Prisma → interceptor → filter)
 * against a real test PostgreSQL, reusing the conventions established by
 * `auth.e2e.spec.ts`: bootstrap the whole `AppModule`, sign up + log in real
 * users for genuine HS256 access tokens, and seed catalog rows directly via
 * Prisma.
 *
 * Covers:
 * - Happy path: `200`, exact Pagination_Envelope shape, single `color_class`
 *   data key, snake_case fields, deterministic `code`-ascending ordering
 *   (Properties 6, 7; Req 1.2, 7.5).
 * - Authentication gate (Property 12; Req 1.6, 5.1): missing header,
 *   non-`Bearer` scheme, syntactically invalid token, and expired token all
 *   yield `401 UNAUTHENTICATED` with no records leaked.
 * - Email-verification gate (Property 13; Req 5.3, 5.4): an authenticated but
 *   unverified user yields `403 EMAIL_NOT_VERIFIED` with no records leaked.
 * - Guard order (Req 5.1 → 5.3): `JwtAuthGuard` runs before
 *   `EmailVerifiedGuard`, so a missing token is `401` (not `403`) and a valid
 *   token for an unverified user is `403`.
 * - Error envelope shape (Property 19; Req 8.1, 8.2, 8.3, 8.4).
 */

const VALID_PASSWORD = 'sup3r-secret-pw';
const DEVICE = { user_agent: 'jest', os: 'linux', browser: 'node' };

/** A unique email per invocation so tests never collide on the unique index. */
function uniqueEmail(prefix = 'cc-e2e'): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

/** Deletes catalog + auth rows in FK-safe order (children first). */
async function cleanDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.officialColor.deleteMany();
  await prisma.colorClass.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.emailVerificationToken.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.user.deleteMany();
}

describe('ColorClass e2e (HTTP)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaClient;

  /**
   * Seed dataset authored deliberately out of `code` order so the endpoint's
   * ascending-`code` ordering is observable. Codes chosen so that a C-collated
   * (code-point) ascending sort yields a stable, predictable sequence.
   */
  const seededClasses = [
    { name: 'Fundo Pastel', code: 'CC-30' },
    { name: 'Fundo Branco', code: 'CC-10' },
    { name: 'Fundo Amarelo', code: 'CC-20' },
  ];
  const expectedCodeOrder = ['CC-10', 'CC-20', 'CC-30'];

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    await cleanDatabase(prisma);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Generous limiter so signup/login helper flows never trip the limit.
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

    // Seed the global catalog directly (Prisma is the sole writer of catalogs).
    for (const c of seededClasses) {
      await prisma.colorClass.create({ data: c });
    }
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
    await prisma.$disconnect();
  });

  /** Signs up a fresh user and returns its email/id. */
  async function signup(
    email = uniqueEmail(),
  ): Promise<{ email: string; id: string }> {
    const res = await request(server)
      .post('/auth/signup')
      .send({
        name: 'CC E2E User',
        email,
        password: VALID_PASSWORD,
        captcha0: 'a',
        captcha1: 'b',
      })
      .expect(201);
    return { email, id: res.body.id as string };
  }

  /** Logs a user in and returns its access token. */
  async function login(email: string): Promise<string> {
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
    return res.body.access_token as string;
  }

  /**
   * Signs up a user, marks its email verified directly in the DB, then logs it
   * in. The resulting access token passes both JwtAuthGuard and
   * EmailVerifiedGuard.
   */
  async function verifiedUserToken(): Promise<string> {
    const { email, id } = await signup();
    await prisma.user.update({
      where: { id },
      data: { emailVerifiedAt: new Date() },
    });
    return login(email);
  }

  describe('GET /color-class (happy path)', () => {
    it('returns 200 with the Pagination_Envelope shape and snake_case body for a verified user (Req 7.5, Property 6, 7)', async () => {
      const token = await verifiedUserToken();

      const res = await request(server)
        .get('/color-class')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Property 7: exactly data/links/meta at the top level.
      expect(Object.keys(res.body).sort()).toEqual(['data', 'links', 'meta']);
      // data has exactly one key: color_class.
      expect(Object.keys(res.body.data)).toEqual(['color_class']);
      expect(Array.isArray(res.body.data.color_class)).toBe(true);
      expect(res.body.data.color_class).toHaveLength(seededClasses.length);

      // Property 6: every record field is snake_case (id, name, code only).
      for (const row of res.body.data.color_class) {
        expect(Object.keys(row).sort()).toEqual(['code', 'id', 'name']);
        expect(typeof row.id).toBe('string');
        expect(row.id.length).toBeGreaterThan(0);
        expect(typeof row.name).toBe('string');
        expect(row.name.length).toBeGreaterThan(0);
        expect(typeof row.code).toBe('string');
        expect(row.code.length).toBeGreaterThan(0);
      }

      // meta reflects a single full page for the small, stable catalog.
      expect(res.body.meta).toEqual({
        current_page: 1,
        from: 1,
        last_page: 1,
        per_page: seededClasses.length,
        to: seededClasses.length,
        total: seededClasses.length,
      });
      expect(res.body.links).toEqual({
        first: '',
        last: '',
        prev: null,
        next: null,
      });
    });

    it('returns records sorted by code ascending, byte-for-byte stable across repeated requests (Req 1.5, Property 3)', async () => {
      const token = await verifiedUserToken();

      const first = await request(server)
        .get('/color-class')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const codes = first.body.data.color_class.map(
        (r: { code: string }) => r.code,
      );
      expect(codes).toEqual(expectedCodeOrder);

      // Repeated identical request → identical serialized ordering.
      const second = await request(server)
        .get('/color-class')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(JSON.stringify(second.body)).toEqual(JSON.stringify(first.body));
    });

    it('serves the identical global set to two distinct verified users (no tenant filter) (Req 1.2, Property 2)', async () => {
      const tokenA = await verifiedUserToken();
      const tokenB = await verifiedUserToken();

      const resA = await request(server)
        .get('/color-class')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const resB = await request(server)
        .get('/color-class')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(resB.body.data.color_class).toEqual(resA.body.data.color_class);
    });
  });

  describe('GET /color-class (authentication gate — Property 12, Req 1.6, 5.1)', () => {
    /** Asserts a 401 UNAUTHENTICATED envelope with no catalog records leaked. */
    function assertUnauthenticated(res: request.Response): void {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: {
          code: 'UNAUTHENTICATED',
          message: expect.any(String),
          details: [],
        },
      });
      expect(res.body.data).toBeUndefined();
    }

    it('rejects a missing Authorization header with 401 (JwtAuthGuard runs first, not 403)', async () => {
      const res = await request(server).get('/color-class');
      assertUnauthenticated(res);
    });

    it('rejects a non-Bearer scheme (Basic) with 401', async () => {
      const res = await request(server)
        .get('/color-class')
        .set('Authorization', 'Basic dXNlcjpwYXNz');
      assertUnauthenticated(res);
    });

    it('rejects a syntactically invalid token with 401', async () => {
      const res = await request(server)
        .get('/color-class')
        .set('Authorization', 'Bearer not-a-real-jwt');
      assertUnauthenticated(res);
    });

    it('rejects an expired (but correctly signed) token with 401', async () => {
      // Craft a token signed with the app's JWT_SECRET but already expired,
      // mirroring how the app signs (HS256, `sub` claim). Passport rejects it
      // for expiry before the strategy's validate runs.
      const jwt = new JwtService({});
      const expired = jwt.sign(
        { sub: randomUUID() },
        {
          secret: process.env.JWT_SECRET,
          algorithm: 'HS256',
          expiresIn: '-1h',
        },
      );

      const res = await request(server)
        .get('/color-class')
        .set('Authorization', `Bearer ${expired}`);
      assertUnauthenticated(res);
    });
  });

  describe('GET /color-class (response-time budget — Req 1.7)', () => {
    it('returns 200 within the 2000 ms performance budget for a verified user against the seeded catalog', async () => {
      // Req 1.7: GET /color-class must respond within 2000 ms from request
      // receipt to response dispatch. This is a single measured request
      // against the already-seeded catalog — a lightweight performance smoke
      // test, not a property-based iteration.
      const token = await verifiedUserToken();

      const startNs = process.hrtime.bigint();
      await request(server)
        .get('/color-class')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;

      expect(elapsedMs).toBeLessThan(2000);
    });
  });

  describe('GET /color-class (email-verification gate — Property 13, Req 5.3, 5.4)', () => {
    it('rejects an authenticated but unverified user with 403 EMAIL_NOT_VERIFIED and no records (EmailVerifiedGuard runs second)', async () => {
      const { email } = await signup();
      const token = await login(email); // unverified: email_verified_at is null

      const res = await request(server)
        .get('/color-class')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(res.body).toEqual({
        error: {
          code: 'EMAIL_NOT_VERIFIED',
          message: expect.any(String),
          details: [],
        },
      });
      expect(res.body.data).toBeUndefined();
    });
  });
});
