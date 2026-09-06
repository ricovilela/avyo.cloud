import fc from "fast-check";

import type { RateLimitWindow } from "../rate-limiter";
import { DevCaptchaVerifier } from "./dev-captcha-verifier";
import { DEFAULT_RATE_LIMIT_WINDOW, InMemoryRateLimiter } from "./in-memory-rate-limiter";
import { RecordingMailer } from "./recording-mailer";

describe("DevCaptchaVerifier", () => {
  it("always resolves true regardless of inputs", async () => {
    const verifier = new DevCaptchaVerifier();
    await expect(verifier.verify("", "")).resolves.toBe(true);
    await expect(verifier.verify("anything", "else", "1.2.3.4")).resolves.toBe(true);
  });
});

describe("RecordingMailer", () => {
  it("records verification emails with accessors", async () => {
    const mailer = new RecordingMailer();
    await mailer.sendVerificationEmail("user@example.com", "verify-token");

    expect(mailer.count).toBe(1);
    expect(mailer.verificationEmails).toEqual([
      { kind: "verification", to: "user@example.com", token: "verify-token" },
    ]);
    expect(mailer.passwordResetEmails).toEqual([]);
    expect(mailer.lastEmail).toEqual({
      kind: "verification",
      to: "user@example.com",
      token: "verify-token",
    });
  });

  it("records password reset emails and preserves dispatch order", async () => {
    const mailer = new RecordingMailer();
    await mailer.sendVerificationEmail("a@example.com", "t1");
    await mailer.sendPasswordResetEmail("b@example.com", "t2");

    expect(mailer.sent).toEqual([
      { kind: "verification", to: "a@example.com", token: "t1" },
      { kind: "password_reset", to: "b@example.com", token: "t2" },
    ]);
    expect(mailer.passwordResetEmails).toEqual([
      { kind: "password_reset", to: "b@example.com", token: "t2" },
    ]);
  });

  it("reset() clears recorded emails", async () => {
    const mailer = new RecordingMailer();
    await mailer.sendVerificationEmail("a@example.com", "t1");
    mailer.reset();
    expect(mailer.count).toBe(0);
    expect(mailer.sent).toEqual([]);
  });
});

describe("InMemoryRateLimiter", () => {
  it("uses the requirement defaults (60s, 10/ip, 5/email)", () => {
    expect(DEFAULT_RATE_LIMIT_WINDOW).toEqual({
      windowSeconds: 60,
      maxPerIp: 10,
      maxPerEmail: 5,
    });
  });

  it("allows requests below both limits", async () => {
    const limiter = new InMemoryRateLimiter();
    const result = await limiter.hit("/auth/login", "1.1.1.1", "user@example.com");
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("blocks the request that reaches the per-email limit", async () => {
    const limiter = new InMemoryRateLimiter({
      windowSeconds: 60,
      maxPerIp: 100,
      maxPerEmail: 5,
    });
    // Vary IPs so only the email limit trips.
    for (let i = 0; i < 5; i++) {
      const res = await limiter.hit("/auth/login", `10.0.0.${i}`, "user@example.com");
      expect(res.allowed).toBe(true);
    }
    const blocked = await limiter.hit("/auth/login", "10.0.0.99", "user@example.com");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("blocks the request that reaches the per-IP limit", async () => {
    const limiter = new InMemoryRateLimiter({
      windowSeconds: 60,
      maxPerIp: 10,
      maxPerEmail: 100,
    });
    for (let i = 0; i < 10; i++) {
      const res = await limiter.hit("/auth/signup", "1.2.3.4", `user${i}@example.com`);
      expect(res.allowed).toBe(true);
    }
    const blocked = await limiter.hit("/auth/signup", "1.2.3.4", "another@example.com");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts emails case-insensitively after trimming", async () => {
    const limiter = new InMemoryRateLimiter({
      windowSeconds: 60,
      maxPerIp: 100,
      maxPerEmail: 2,
    });
    await limiter.hit("/auth/login", "1.1.1.1", "User@Example.com");
    await limiter.hit("/auth/login", "2.2.2.2", "  user@example.com  ");
    const blocked = await limiter.hit("/auth/login", "3.3.3.3", "USER@EXAMPLE.COM");
    expect(blocked.allowed).toBe(false);
  });

  it("counts endpoints independently", async () => {
    const limiter = new InMemoryRateLimiter({
      windowSeconds: 60,
      maxPerIp: 1,
      maxPerEmail: 100,
    });
    await limiter.hit("/auth/login", "1.1.1.1", null);
    const otherEndpoint = await limiter.hit("/auth/signup", "1.1.1.1", null);
    expect(otherEndpoint.allowed).toBe(true);
    const sameEndpoint = await limiter.hit("/auth/login", "1.1.1.1", null);
    expect(sameEndpoint.allowed).toBe(false);
  });

  it("frees the window as hits age out", async () => {
    jest.useFakeTimers();
    try {
      const start = Date.now();
      jest.setSystemTime(start);
      const limiter = new InMemoryRateLimiter({
        windowSeconds: 60,
        maxPerIp: 1,
        maxPerEmail: 100,
      });
      await limiter.hit("/auth/login", "1.1.1.1", null);
      const blocked = await limiter.hit("/auth/login", "1.1.1.1", null);
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterSeconds).toBe(60);

      jest.setSystemTime(start + 60_001);
      const allowedAgain = await limiter.hit("/auth/login", "1.1.1.1", null);
      expect(allowedAgain.allowed).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  // Property-based coverage of the rolling-window decision logic. This
  // exercises the fake in isolation (no ports/framework), complementing the
  // endpoint-level Property 27 test written elsewhere in the plan.
  it("never allows more than the configured limits within a window", async () => {
    const windowArb: fc.Arbitrary<RateLimitWindow> = fc.record({
      windowSeconds: fc.integer({ min: 1, max: 3600 }),
      maxPerIp: fc.integer({ min: 1, max: 20 }),
      maxPerEmail: fc.integer({ min: 1, max: 20 }),
    });

    await fc.assert(
      fc.asyncProperty(
        windowArb,
        fc.array(
          fc.record({
            ip: fc.constantFrom("1.1.1.1", "2.2.2.2"),
            email: fc.constantFrom("a@example.com", "b@example.com", null),
          }),
          { minLength: 1, maxLength: 60 },
        ),
        async (window, requests) => {
          const limiter = new InMemoryRateLimiter(window);
          const endpoint = "/auth/login";
          const allowedByIp = new Map<string, number>();
          const allowedByEmail = new Map<string, number>();

          for (const req of requests) {
            const result = await limiter.hit(endpoint, req.ip, req.email);
            const normEmail = req.email?.trim().toLowerCase() || null;
            if (result.allowed) {
              allowedByIp.set(req.ip, (allowedByIp.get(req.ip) ?? 0) + 1);
              if (normEmail !== null) {
                allowedByEmail.set(normEmail, (allowedByEmail.get(normEmail) ?? 0) + 1);
              }
            } else {
              expect(Number.isInteger(result.retryAfterSeconds)).toBe(true);
              expect(result.retryAfterSeconds).toBeGreaterThan(0);
            }
          }

          for (const count of allowedByIp.values()) {
            expect(count).toBeLessThanOrEqual(window.maxPerIp);
          }
          for (const count of allowedByEmail.values()) {
            expect(count).toBeLessThanOrEqual(window.maxPerEmail);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
