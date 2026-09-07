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
import { OfficialColorService } from './official-color.service';

jest.setTimeout(60_000);

/**
 * `GET /official-color` e2e coverage.
 *
 * Exercises the endpoint end-to-end over real HTTP against a test PostgreSQL,
 * bootstrapping the real {@link AppModule} (so the global `ValidationPipe`,
 * `SnakeCaseInterceptor`, and `AllExceptionsFilter` are all in force) and
 * reusing the auth module's guards. Test data is seeded directly through
 * Prisma. Covers:
 *
 * - happy path + filter paths (`class_id`, `age_group`, combined, matching-none)
 *   — Properties 2, 7, 14; Req 2.2, 3.2, 3.4, 4.1, 4.3, 4.4
 * - validation errors (non-UUID `class_id`, bad `age_group`, unknown param)
 *   — Property 19; Req 3.3, 4.2, 8.1, 8.2, 8.3
 * - auth/verification gates (401 / 403) — Properties 12, 13; Req 2.7, 5.1, 5.3
 * - envelope + snake_case serialization — Properties 6, 7; Req 2.4, 7.5
 * - unmapped-error 500 INTERNAL generic message — Property 20; Req 8.5, 8.6
 */

const VALID_PASSWORD = 'sup3r-secret-pw';
const DEVICE = { user_agent: 'jest', os: 'linux', browser: 'node' };

/** A bare signer used to forge expired/foreign-secret access tokens. */
const signer = new JwtService({});

/** A unique email per invocation so tests never collide on the unique index. */
function uniqueEmail(prefix = 'oc-e2e'): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

/** Deletes catalog rows FK-safe (official_color before color_class), then auth. */
async function cleanDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.officialColor.deleteMany();
  await prisma.colorClass.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.emailVerificationToken.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.user.deleteMany();
}

describe('OfficialColor e2e (HTTP)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaClient;

  // Seeded catalog ids, captured in beforeAll.
  let classAId: string; // "AA" — has young + adult
  let classBId: string; // "BB" — has adult only
  let seededClassIds: string[];

  let verifiedToken: string;
  let unverifiedToken: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    await cleanDatabase(prisma);

    // --- Seed the global catalog directly via Prisma. --------------------
    const classA = await prisma.colorClass.create({
      data: { name: 'Fundo Branco', code: 'AA' },
    });
    const classB = await prisma.colorClass.create({
      data: { name: 'Fundo Amarelo', code: 'BB' },
    });
    classAId = classA.id;
    classBId = classB.id;
    seededClassIds = [classAId, classBId];

    await prisma.officialColor.createMany({
      data: [
        { classId: classAId, ageGroup: 'young', code: 'A1', title: 'A1 young' },
        { classId: classAId, ageGroup: 'adult', code: 'A1', title: 'A1 adult' },
        { classId: classAId, ageGroup: 'young', code: 'A2', title: 'A2 young' },
        { classId: classBId, ageGroup: 'adult', code: 'B1', title: 'B1 adult' },
      ],
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
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

    // A verified user (passes both guards) and an unverified user (fails the
    // email-verification gate). Tokens are minted through the real login flow.
    verifiedToken = await createUserAndLogin({ verified: true });
    unverifiedToken = await createUserAndLogin({ verified: false });
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
    await prisma.$disconnect();
  });

  /** Signs up, optionally verifies the email, then logs in for an access token. */
  async function createUserAndLogin({
    verified,
  }: {
    verified: boolean;
  }): Promise<string> {
    const email = uniqueEmail();
    const signupRes = await request(server)
      .post('/auth/signup')
      .send({
        name: 'OC User',
        email,
        password: VALID_PASSWORD,
        captcha0: 'a',
        captcha1: 'b',
      })
      .expect(201);

    if (verified) {
      await prisma.user.update({
        where: { id: signupRes.body.id as string },
        data: { emailVerifiedAt: new Date() },
      });
    }

    const loginRes = await request(server)
      .post('/auth/login')
      .send({
        email,
        password: VALID_PASSWORD,
        captcha0: 'a',
        captcha1: 'b',
        device: DEVICE,
      })
      .expect(200);

    return loginRes.body.access_token as string;
  }

  /** Assert the standard pagination envelope shape (Property 7, Req 7.5). */
  function expectOfficialColorEnvelope(body: unknown): Array<Record<string, unknown>> {
    expect(Object.keys(body as object).sort()).toEqual(['data', 'links', 'meta']);
    const data = (body as { data: Record<string, unknown> }).data;
    expect(Object.keys(data)).toEqual(['official_color']);
    const rows = data.official_color as Array<Record<string, unknown>>;
    expect(Array.isArray(rows)).toBe(true);
    return rows;
  }

  describe('happy path + serialization', () => {
    it('returns 200 with the full catalog under the official_color envelope key (Req 2.1, 7.5)', async () => {
      const res = await request(server)
        .get('/official-color')
        .set('Authorization', `Bearer ${verifiedToken}`)
        .expect(200);

      const rows = expectOfficialColorEnvelope(res.body);
      expect(rows).toHaveLength(4);

      // meta reports the single-page, whole-set contract.
      expect(res.body.meta).toEqual({
        current_page: 1,
        from: 1,
        last_page: 1,
        per_page: 4,
        to: 4,
        total: 4,
      });
    });

    it('serializes every field name in snake_case: class_id/age_group, not classId/ageGroup (Property 6, Req 2.4, 7.4)', async () => {
      const res = await request(server)
        .get('/official-color')
        .set('Authorization', `Bearer ${verifiedToken}`)
        .expect(200);

      const rows = expectOfficialColorEnvelope(res.body);
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(
          ['age_group', 'class_id', 'code', 'id', 'title'].sort(),
        );
        expect(row).not.toHaveProperty('classId');
        expect(row).not.toHaveProperty('ageGroup');
        expect(['young', 'adult']).toContain(row.age_group);
      }

      // No camelCase leaks anywhere in the serialized body.
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain('classId');
      expect(serialized).not.toContain('ageGroup');
    });

    it('every returned row references a seeded color_class id (Property 14, Req 3.1)', async () => {
      const res = await request(server)
        .get('/official-color')
        .set('Authorization', `Bearer ${verifiedToken}`)
        .expect(200);

      const rows = expectOfficialColorEnvelope(res.body);
      for (const row of rows) {
        expect(seededClassIds).toContain(row.class_id);
      }
    });
  });

  describe('filter paths', () => {
    it('class_id filter returns only that class subset (Req 3.2)', async () => {
      const res = await request(server)
        .get('/official-color')
        .query({ class_id: classAId })
        .set('Authorization', `Bearer ${verifiedToken}`)
        .expect(200);

      const rows = expectOfficialColorEnvelope(res.body);
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.class_id).toBe(classAId);
      }
    });

    it('valid UUID class_id matching no class returns 200 empty (Req 3.4)', async () => {
      const res = await request(server)
        .get('/official-color')
        .query({ class_id: randomUUID() })
        .set('Authorization', `Bearer ${verifiedToken}`)
        .expect(200);

      const rows = expectOfficialColorEnvelope(res.body);
      expect(rows).toHaveLength(0);
      expect(res.body.meta.total).toBe(0);
      expect(res.body.meta.from).toBeNull();
      expect(res.body.meta.to).toBeNull();
    });

    it('age_group filter returns only that age group (Req 4.1)', async () => {
      const res = await request(server)
        .get('/official-color')
        .query({ age_group: 'young' })
        .set('Authorization', `Bearer ${verifiedToken}`)
        .expect(200);

      const rows = expectOfficialColorEnvelope(res.body);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.age_group).toBe('young');
      }
    });

    it('combined class_id + age_group ANDs both conditions (Req 4.3)', async () => {
      const res = await request(server)
        .get('/official-color')
        .query({ class_id: classAId, age_group: 'adult' })
        .set('Authorization', `Bearer ${verifiedToken}`)
        .expect(200);

      const rows = expectOfficialColorEnvelope(res.body);
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row!.class_id).toBe(classAId);
      expect(row!.age_group).toBe('adult');
      expect(row!.code).toBe('A1');
    });

    it('age_group filter matching no record returns 200 empty (Req 4.4)', async () => {
      const res = await request(server)
        .get('/official-color')
        .query({ class_id: classBId, age_group: 'young' })
        .set('Authorization', `Bearer ${verifiedToken}`)
        .expect(200);

      const rows = expectOfficialColorEnvelope(res.body);
      expect(rows).toHaveLength(0);
    });
  });

  describe('validation errors (Property 19, Req 3.3, 4.2, 8.1, 8.2, 8.3)', () => {
    /** Assert the standard VALIDATION_ERROR envelope with field-level details. */
    function expectValidationEnvelope(body: unknown): void {
      expect(Object.keys(body as object)).toEqual(['error']);
      const error = (body as { error: Record<string, unknown> }).error;
      expect(Object.keys(error).sort()).toEqual(['code', 'details', 'message'].sort());
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(typeof error.message).toBe('string');
      expect((error.message as string).length).toBeGreaterThanOrEqual(1);
      const details = error.details as Array<Record<string, unknown>>;
      expect(Array.isArray(details)).toBe(true);
      expect(details.length).toBeGreaterThanOrEqual(1);
      for (const detail of details) {
        expect(Object.keys(detail).sort()).toEqual(['field', 'message'].sort());
        expect(typeof detail.field).toBe('string');
        expect(typeof detail.message).toBe('string');
      }
    }

    it('non-UUID class_id → 400 VALIDATION_ERROR with details (Req 3.3)', async () => {
      const res = await request(server)
        .get('/official-color')
        .query({ class_id: 'not-a-uuid' })
        .set('Authorization', `Bearer ${verifiedToken}`)
        .expect(400);

      expectValidationEnvelope(res.body);
      expect(res.body.data).toBeUndefined();
    });

    it.each(['Young', 'ADULT', '', ' '])(
      'bad age_group %p → 400 VALIDATION_ERROR (Req 4.2)',
      async (bad) => {
        const res = await request(server)
          .get('/official-color')
          .query({ age_group: bad })
          .set('Authorization', `Bearer ${verifiedToken}`)
          .expect(400);

        expectValidationEnvelope(res.body);
        expect(res.body.data).toBeUndefined();
      },
    );

    it('unknown query parameter → 400 VALIDATION_ERROR (forbidNonWhitelisted)', async () => {
      const res = await request(server)
        .get('/official-color')
        .query({ bogus: 'x' })
        .set('Authorization', `Bearer ${verifiedToken}`)
        .expect(400);

      expectValidationEnvelope(res.body);
      expect(res.body.data).toBeUndefined();
    });
  });

  describe('authentication gate (Property 12, Req 2.7, 5.1)', () => {
    it('missing Authorization header → 401 UNAUTHENTICATED, no records', async () => {
      const res = await request(server).get('/official-color').expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.body.data).toBeUndefined();
    });

    it('non-Bearer scheme → 401 UNAUTHENTICATED', async () => {
      const res = await request(server)
        .get('/official-color')
        .set('Authorization', `Basic ${verifiedToken}`)
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.body.data).toBeUndefined();
    });

    it('syntactically invalid token → 401 UNAUTHENTICATED', async () => {
      const res = await request(server)
        .get('/official-color')
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.body.data).toBeUndefined();
    });

    it('expired token → 401 UNAUTHENTICATED', async () => {
      const expired = signer.sign(
        { sub: randomUUID() },
        {
          secret: process.env.JWT_SECRET as string,
          algorithm: 'HS256',
          expiresIn: '-10s',
        },
      );
      const res = await request(server)
        .get('/official-color')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.body.data).toBeUndefined();
    });
  });

  // Feature: color-catalogs, Property 2: Global catalogs apply no tenant filter
  describe('global read — no tenant filter (Property 2, Req 2.2)', () => {
    it('serves the identical global set to two distinct verified users', async () => {
      // Two independently-registered, independently-verified users. If any
      // `user_id`/tenant filter were applied, their result sets could diverge.
      const tokenUserOne = await createUserAndLogin({ verified: true });
      const tokenUserTwo = await createUserAndLogin({ verified: true });

      const resOne = await request(server)
        .get('/official-color')
        .set('Authorization', `Bearer ${tokenUserOne}`)
        .expect(200);
      const resTwo = await request(server)
        .get('/official-color')
        .set('Authorization', `Bearer ${tokenUserTwo}`)
        .expect(200);

      const rowsOne = expectOfficialColorEnvelope(resOne.body);
      const rowsTwo = expectOfficialColorEnvelope(resTwo.body);

      // Both users must see the full seeded catalog...
      expect(rowsOne).toHaveLength(4);
      expect(rowsTwo).toHaveLength(4);

      // ...and byte-for-byte identical official_color result sets, confirming
      // no tenant/user_id filter is applied.
      expect(JSON.stringify(rowsTwo)).toBe(JSON.stringify(rowsOne));
      expect(JSON.stringify(resTwo.body.data.official_color)).toBe(
        JSON.stringify(resOne.body.data.official_color),
      );
    });
  });

  describe('email-verification gate (Property 13, Req 5.3, 5.4)', () => {
    it('unverified user → 403 EMAIL_NOT_VERIFIED, no records', async () => {
      const res = await request(server)
        .get('/official-color')
        .set('Authorization', `Bearer ${unverifiedToken}`)
        .expect(403);
      expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      expect(res.body.data).toBeUndefined();
    });
  });
});

/**
 * Separate app instance whose {@link OfficialColorService} is overridden with a
 * failing stub, to exercise the unmapped-error path: the global
 * `AllExceptionsFilter` must collapse an arbitrary thrown `Error` into a
 * `500 INTERNAL` envelope with a generic message that leaks no internal detail
 * (Property 20, Req 8.5, 8.6). Mirrors how the auth e2e spins up a dedicated app
 * for the rate-limiting suite.
 */
describe('OfficialColor e2e (unmapped error → 500 INTERNAL)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaClient;
  let token: string;

  const SECRET_LEAK = 'super-secret-internal-db-detail-should-not-leak';

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
          maxPerIp: 100_000,
          maxPerEmail: 100_000,
        }),
      )
      .overrideProvider(OfficialColorService)
      .useValue({
        list: () => {
          throw new Error(SECRET_LEAK);
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer();

    // A verified user so the request reaches the (failing) handler.
    const email = uniqueEmail('oc-500');
    const signupRes = await request(server)
      .post('/auth/signup')
      .send({
        name: 'OC 500',
        email,
        password: VALID_PASSWORD,
        captcha0: 'a',
        captcha1: 'b',
      })
      .expect(201);
    await prisma.user.update({
      where: { id: signupRes.body.id as string },
      data: { emailVerifiedAt: new Date() },
    });
    const loginRes = await request(server)
      .post('/auth/login')
      .send({
        email,
        password: VALID_PASSWORD,
        captcha0: 'a',
        captcha1: 'b',
        device: DEVICE,
      })
      .expect(200);
    token = loginRes.body.access_token as string;
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
    await prisma.$disconnect();
  });

  it('collapses an unmapped error to 500 INTERNAL with a generic, leak-free message (Property 20, Req 8.5, 8.6)', async () => {
    const res = await request(server)
      .get('/official-color')
      .set('Authorization', `Bearer ${token}`)
      .expect(500);

    expect(Object.keys(res.body)).toEqual(['error']);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error.message.length).toBeGreaterThanOrEqual(1);
    expect(res.body.error.message.length).toBeLessThanOrEqual(500);
    expect(res.body.error.details).toEqual([]);

    // No internal implementation detail leaks: not the thrown message, not a
    // stack trace, not the exception class name.
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(SECRET_LEAK);
    expect(serialized).not.toContain('Error');
    expect(serialized).not.toContain('at ');
  });
});
