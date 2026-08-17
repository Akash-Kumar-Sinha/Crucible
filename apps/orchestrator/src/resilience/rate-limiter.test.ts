import { describe, it, expect } from "bun:test";
import { TokenBucket, MultiTierRateLimiter } from "./rate-limiter";

describe("TokenBucket & MultiTierRateLimiter (Rate Limiting Pattern)", () => {
  describe("TokenBucket", () => {
    it("allows consumption up to burst capacity", () => {
      const bucket = new TokenBucket({ capacity: 3, refillRatePerSecond: 1 });

      expect(bucket.tryAcquire(1).allowed).toBe(true);
      expect(bucket.tryAcquire(1).allowed).toBe(true);
      expect(bucket.tryAcquire(1).allowed).toBe(true);

      const fourth = bucket.tryAcquire(1);
      expect(fourth.allowed).toBe(false);
      expect(fourth.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    });

    it("refills tokens over time proportionally to elapsed delta", async () => {
      const bucket = new TokenBucket({ capacity: 2, refillRatePerSecond: 20 }); // 20 tokens/sec
      expect(bucket.tryAcquire(2).allowed).toBe(true);
      expect(bucket.tryAcquire(1).allowed).toBe(false);

      // Wait 100ms -> should refill ~2 tokens
      await new Promise((r) => setTimeout(r, 100));

      expect(bucket.tryAcquire(1).allowed).toBe(true);
    });
  });

  describe("MultiTierRateLimiter", () => {
    it("enforces per-session rate limits", () => {
      const limiter = new MultiTierRateLimiter({
        sessionLimit: { capacity: 2, refillRatePerSecond: 0.1 },
      });

      expect(limiter.checkRateLimit({ sessionId: "sess_1" }).allowed).toBe(
        true,
      );
      expect(limiter.checkRateLimit({ sessionId: "sess_1" }).allowed).toBe(
        true,
      );

      const rejected = limiter.checkRateLimit({ sessionId: "sess_1" });
      expect(rejected.allowed).toBe(false);
      expect(rejected.retryAfterSeconds).toBeGreaterThan(0);

      // Different session is unaffected
      expect(limiter.checkRateLimit({ sessionId: "sess_2" }).allowed).toBe(
        true,
      );
    });

    it("enforces per-tenant rate limits across sessions", () => {
      const limiter = new MultiTierRateLimiter({
        sessionLimit: { capacity: 10, refillRatePerSecond: 1 },
        tenantLimit: { capacity: 2, refillRatePerSecond: 0.1 },
      });

      expect(
        limiter.checkRateLimit({ tenantId: "t1", sessionId: "s1" }).allowed,
      ).toBe(true);
      expect(
        limiter.checkRateLimit({ tenantId: "t1", sessionId: "s2" }).allowed,
      ).toBe(true);

      const third = limiter.checkRateLimit({ tenantId: "t1", sessionId: "s3" });
      expect(third.allowed).toBe(false);

      // Different tenant is unaffected
      expect(
        limiter.checkRateLimit({ tenantId: "t2", sessionId: "s4" }).allowed,
      ).toBe(true);
    });

    it("formats RFC 6585 rate limit headers and 429 response", async () => {
      const limiter = new MultiTierRateLimiter({
        sessionLimit: { capacity: 1, refillRatePerSecond: 0.1 },
      });

      limiter.checkRateLimit({ sessionId: "s1" });
      const blocked = limiter.checkRateLimit({ sessionId: "s1" });

      const headers = limiter.createHeaders(blocked);
      expect(headers["X-RateLimit-Limit"]).toBe("1");
      expect(headers["X-RateLimit-Remaining"]).toBe("0");
      expect(headers["Retry-After"]).toBeDefined();

      const res = limiter.create429Response(blocked, "session s1");
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.status).toBe("error");
      expect(json.error.code).toBe("RATE_LIMIT_EXCEEDED");
    });
  });
});
