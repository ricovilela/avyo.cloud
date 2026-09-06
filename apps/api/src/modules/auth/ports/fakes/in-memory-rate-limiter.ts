import { Injectable } from "@nestjs/common";

import type { RateLimiter, RateLimitWindow } from "../rate-limiter";

/**
 * Default rolling-window configuration.
 *
 * Values come from requirements 9.1/9.2/9.3: a 60-second window, at most 10
 * requests per client IP, and at most 5 requests per email address.
 */
export const DEFAULT_RATE_LIMIT_WINDOW: RateLimitWindow = {
  windowSeconds: 60,
  maxPerIp: 10,
  maxPerEmail: 5,
};

/**
 * In-memory rolling-window rate limiter usable in tests and as the default
 * dev binding until a shared-store implementation (Postgres/Redis) is chosen.
 *
 * Counts are kept per endpoint, independently by client IP and by email
 * (compared case-insensitively after trimming). A request is allowed only
 * while both its IP count and its email count are below the configured
 * limits within the rolling window; allowed requests are recorded, rejected
 * ones are not (so the window can free up). When rejected, the returned
 * `retryAfterSeconds` is the whole number of seconds until the request would
 * be accepted again.
 */
@Injectable()
export class InMemoryRateLimiter implements RateLimiter {
  private readonly window: RateLimitWindow;

  /** Bucket key -> ascending timestamps (ms) of recorded hits within the window. */
  private readonly hits = new Map<string, number[]>();

  constructor(window: RateLimitWindow = DEFAULT_RATE_LIMIT_WINDOW) {
    this.window = window;
  }

  hit(
    endpoint: string,
    ip: string,
    email: string | null,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const now = Date.now();
    const windowMs = this.window.windowSeconds * 1000;

    const ipKey = `${endpoint}|ip|${ip}`;
    const normalizedEmail = InMemoryRateLimiter.normalizeEmail(email);
    const emailKey =
      normalizedEmail === null ? null : `${endpoint}|email|${normalizedEmail}`;

    const ipTimestamps = this.prune(ipKey, now, windowMs);
    const emailTimestamps =
      emailKey === null ? [] : this.prune(emailKey, now, windowMs);

    const ipOverLimit = ipTimestamps.length >= this.window.maxPerIp;
    const emailOverLimit =
      emailKey !== null && emailTimestamps.length >= this.window.maxPerEmail;

    if (ipOverLimit || emailOverLimit) {
      const retryAfterMs = Math.max(
        ipOverLimit ? this.retryAfterMs(ipTimestamps, this.window.maxPerIp, now, windowMs) : 0,
        emailOverLimit
          ? this.retryAfterMs(emailTimestamps, this.window.maxPerEmail, now, windowMs)
          : 0,
      );
      return Promise.resolve({
        allowed: false,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      });
    }

    ipTimestamps.push(now);
    this.hits.set(ipKey, ipTimestamps);
    if (emailKey !== null) {
      emailTimestamps.push(now);
      this.hits.set(emailKey, emailTimestamps);
    }

    return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
  }

  /** Clears all recorded counts (useful between test cases). */
  reset(): void {
    this.hits.clear();
  }

  private static normalizeEmail(email: string | null): string | null {
    if (email === null) {
      return null;
    }
    const normalized = email.trim().toLowerCase();
    return normalized.length === 0 ? null : normalized;
  }

  /** Drops timestamps that have fallen out of the rolling window and returns the survivors. */
  private prune(key: string, now: number, windowMs: number): number[] {
    const threshold = now - windowMs;
    const existing = this.hits.get(key) ?? [];
    const survivors = existing.filter((timestamp) => timestamp > threshold);
    if (survivors.length === 0) {
      this.hits.delete(key);
    } else if (survivors.length !== existing.length) {
      this.hits.set(key, survivors);
    }
    return survivors;
  }

  /**
   * Milliseconds until the bucket drops below `limit`. Enough of the oldest
   * hits must age out of the window so that the count becomes `limit - 1`.
   */
  private retryAfterMs(
    timestamps: number[],
    limit: number,
    now: number,
    windowMs: number,
  ): number {
    // Index of the hit whose expiry brings the count below the limit.
    const freeingIndex = timestamps.length - limit;
    const freeingTimestamp = timestamps[freeingIndex];
    if (freeingTimestamp === undefined) {
      return 0;
    }
    return Math.max(0, freeingTimestamp + windowMs - now);
  }
}
