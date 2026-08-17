import { logger } from "../observability/logger";

export interface RateLimiterOptions {
  capacity: number;
  refillRatePerSecond: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remainingTokens: number;
  limit: number;
  retryAfterSeconds: number;
  resetTimestamp: number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefillTimestamp: number;
  readonly capacity: number;
  readonly refillRatePerSecond: number;

  constructor(options: RateLimiterOptions) {
    this.capacity = Math.max(1, options.capacity);
    this.refillRatePerSecond = Math.max(0.01, options.refillRatePerSecond);
    this.tokens = this.capacity;
    this.lastRefillTimestamp = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillTimestamp) / 1000;
    if (elapsedSeconds > 0) {
      const addedTokens = elapsedSeconds * this.refillRatePerSecond;
      this.tokens = Math.min(this.capacity, this.tokens + addedTokens);
      this.lastRefillTimestamp = now;
    }
  }

  tryAcquire(cost = 1): RateLimitResult {
    this.refill();
    const now = Date.now();

    if (this.tokens >= cost) {
      this.tokens -= cost;
      const resetSeconds =
        (this.capacity - this.tokens) / this.refillRatePerSecond;
      return {
        allowed: true,
        remainingTokens: Math.max(0, Math.floor(this.tokens)),
        limit: this.capacity,
        retryAfterSeconds: 0,
        resetTimestamp: Math.ceil(now / 1000 + resetSeconds),
      };
    }

    const deficit = cost - this.tokens;
    const waitSeconds = Math.ceil(deficit / this.refillRatePerSecond);
    const resetSeconds =
      (this.capacity - this.tokens) / this.refillRatePerSecond;

    return {
      allowed: false,
      remainingTokens: 0,
      limit: this.capacity,
      retryAfterSeconds: Math.max(1, waitSeconds),
      resetTimestamp: Math.ceil(now / 1000 + resetSeconds),
    };
  }

  getTokens(): number {
    this.refill();
    return this.tokens;
  }
}

export interface HierarchicalRateLimiterOptions {
  sessionLimit?: { capacity: number; refillRatePerSecond: number };
  tenantLimit?: { capacity: number; refillRatePerSecond: number };
  globalLimit?: { capacity: number; refillRatePerSecond: number };
}

export class MultiTierRateLimiter {
  private readonly sessionBuckets = new Map<string, TokenBucket>();
  private readonly tenantBuckets = new Map<string, TokenBucket>();
  private readonly globalBucket: TokenBucket;

  private readonly sessionConfig: RateLimiterOptions;
  private readonly tenantConfig: RateLimiterOptions;

  constructor(options: HierarchicalRateLimiterOptions = {}) {
    this.sessionConfig = options.sessionLimit ?? {
      capacity: 30,
      refillRatePerSecond: 0.5, // 30 req / min
    };
    this.tenantConfig = options.tenantLimit ?? {
      capacity: 120,
      refillRatePerSecond: 2.0, // 120 req / min
    };
    this.globalBucket = new TokenBucket(
      options.globalLimit ?? {
        capacity: 1000,
        refillRatePerSecond: 20.0, // 1200 req / min
      },
    );
  }

  checkRateLimit(context: {
    sessionId?: string;
    tenantId?: string;
    cost?: number;
  }): RateLimitResult {
    const cost = context.cost ?? 1;

    // 1. Check global limiter
    const globalRes = this.globalBucket.tryAcquire(cost);
    if (!globalRes.allowed) {
      logger.warn({ context }, "[RateLimiter] Global rate limit exceeded");
      return globalRes;
    }

    // 2. Check tenant limiter
    if (context.tenantId) {
      let tenantBucket = this.tenantBuckets.get(context.tenantId);
      if (!tenantBucket) {
        tenantBucket = new TokenBucket(this.tenantConfig);
        this.tenantBuckets.set(context.tenantId, tenantBucket);
      }
      const tenantRes = tenantBucket.tryAcquire(cost);
      if (!tenantRes.allowed) {
        logger.warn(
          {
            tenantId: context.tenantId,
            retryAfter: tenantRes.retryAfterSeconds,
          },
          "[RateLimiter] Tenant rate limit exceeded",
        );
        return tenantRes;
      }
    }

    // 3. Check session limiter
    if (context.sessionId) {
      let sessionBucket = this.sessionBuckets.get(context.sessionId);
      if (!sessionBucket) {
        sessionBucket = new TokenBucket(this.sessionConfig);
        this.sessionBuckets.set(context.sessionId, sessionBucket);
      }
      const sessionRes = sessionBucket.tryAcquire(cost);
      if (!sessionRes.allowed) {
        logger.warn(
          {
            sessionId: context.sessionId,
            retryAfter: sessionRes.retryAfterSeconds,
          },
          "[RateLimiter] Session rate limit exceeded",
        );
        return sessionRes;
      }
      return sessionRes;
    }

    return globalRes;
  }

  createHeaders(result: RateLimitResult): Record<string, string> {
    const headers: Record<string, string> = {
      "X-RateLimit-Limit": String(result.limit),
      "X-RateLimit-Remaining": String(result.remainingTokens),
      "X-RateLimit-Reset": String(result.resetTimestamp),
    };
    if (!result.allowed) {
      headers["Retry-After"] = String(result.retryAfterSeconds);
    }
    return headers;
  }

  create429Response(result: RateLimitResult, scope?: string): Response {
    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Tenant-ID, X-Namespace",
      ...this.createHeaders(result),
    };

    const body = {
      status: "error",
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: `Too many requests for ${scope || "resource"}. Please retry after ${result.retryAfterSeconds} seconds.`,
        retryAfterSeconds: result.retryAfterSeconds,
        limit: result.limit,
      },
    };

    return new Response(JSON.stringify(body), {
      status: 429,
      headers,
    });
  }

  cleanupInactiveBuckets(_maxAgeMs = 3600_000): void {
    // Periodically prune stale buckets
    if (this.sessionBuckets.size > 5000) {
      this.sessionBuckets.clear();
    }
  }
}

let globalRateLimiter: MultiTierRateLimiter | null = null;

export function getRateLimiter(): MultiTierRateLimiter {
  if (!globalRateLimiter) {
    globalRateLimiter = new MultiTierRateLimiter();
  }
  return globalRateLimiter;
}
