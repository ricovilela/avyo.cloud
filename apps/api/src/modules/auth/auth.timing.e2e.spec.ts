import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { AppModule } from '../../app.module';
import { RATE_LIMITER } from './ports/rate-limiter';
import { InMemoryRateLimiter } from './ports/fakes/in-memory-rate-limiter';

jest.setTimeout(60_000);

/** A unique email per invocation so tests never collide on the unique index. */
function uniqueEmail(prefix = 'timing'): string {
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

/** Returns the median of a numeric sample (average of the two middles when even). */
function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

describe('Auth e2e (timing)', () => {
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
      // A very high limit so the repeated timing samples are never throttled.
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

  /** Signs up a fresh user and returns its email/id. */
  async function signup(
    email = uniqueEmail(),
  ): Promise<{ email: string; id: string }> {
    const res = await request(server)
      .post('/auth/signup')
      .send({
        name: 'Timing User',
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

  /** Issues one forgot-password request and returns its server latency in ms. */
  async function timeForgotPassword(
    email: string,
  ): Promise<{ status: number; ms: number }> {
    const start = Date.now();
    const res = await request(server)
      .post('/auth/forgot-password')
      .send({ email });
    const ms = Date.now() - start;
    return { status: res.status, ms };
  }

  it('does not disclose account existence through forgot-password timing (Req 6.1, 6.5)', async () => {
    const { email: existingEmail } = await signup();
    const missingEmail = uniqueEmail('ghost');

    // Warm-up requests so the first-request cold start does not skew samples.
    await timeForgotPassword(existingEmail);
    await timeForgotPassword(missingEmail);

    const SAMPLES = 5;
    const existing: number[] = [];
    const missing: number[] = [];

    // Interleave measurements to spread transient load evenly across both paths.
    for (let i = 0; i < SAMPLES; i += 1) {
      const e = await timeForgotPassword(existingEmail);
      const m = await timeForgotPassword(missingEmail);

      // Both paths are indistinguishable in HTTP status (204) and body (Req 6.1).
      expect(e.status).toBe(204);
      expect(m.status).toBe(204);

      existing.push(e.ms);
      missing.push(m.ms);
    }

    // Timing must not reveal which email exists: medians within 500 ms (Req 6.5).
    const delta = Math.abs(median(existing) - median(missing));
    expect(delta).toBeLessThanOrEqual(500);
  });

  it('answers forgot-password within its latency bound (Req 6.1)', async () => {
    const { email } = await signup();

    // Warm-up to avoid cold-start skew on the measured request.
    await timeForgotPassword(email);

    const { status, ms } = await timeForgotPassword(email);
    expect(status).toBe(204);
    expect(ms).toBeLessThanOrEqual(2000);
  });

  it('logs out an authenticated session within its latency bound (Req 4.1)', async () => {
    // Warm-up signup+login so cold start does not skew the measured logout.
    const warm = await signup();
    await login(warm.email);

    const { email } = await signup();
    const { access_token, refresh_token } = await login(email);

    const start = Date.now();
    const res = await request(server)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${access_token}`)
      .send({ refresh_token });
    const ms = Date.now() - start;

    expect(res.status).toBe(204);
    expect(ms).toBeLessThanOrEqual(1000);
  });

  it('returns the profile from /auth/me within its latency bound (Req 8.1)', async () => {
    // Warm-up signup+login so cold start does not skew the measured /auth/me.
    const warm = await signup();
    await login(warm.email);

    const { email } = await signup();
    const { access_token } = await login(email);

    const start = Date.now();
    const res = await request(server)
      .post('/auth/me')
      .set('Authorization', `Bearer ${access_token}`);
    const ms = Date.now() - start;

    expect(res.status).toBe(200);
    expect(ms).toBeLessThanOrEqual(2000);
  });
});
