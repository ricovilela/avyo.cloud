export interface RateLimitWindow {
  windowSeconds: number;
  maxPerIp: number;
  maxPerEmail: number;
}

export interface RateLimiter {
  // Records a hit and returns a decision incl. retry_after when limited.
  hit(
    endpoint: string,
    ip: string,
    email: string | null,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

export const RATE_LIMITER = Symbol("RATE_LIMITER");
