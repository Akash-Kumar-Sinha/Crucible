import { EventEmitter } from "node:events";
import { getErrorReporter } from "../observability/error-reporter";
import { logger } from "../observability/logger";

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;
  recoveryTimeoutMs?: number;
  halfOpenSuccessThreshold?: number;
  halfOpenMaxTrials?: number;
  degradedTimeoutMs?: number;
  isFailure?: (error: unknown) => boolean;
}

export interface CircuitBreakerMetrics {
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
  consecutiveSuccesses: number;
  lastStateChange: string;
  lastError?: string;
  nextRetryTimestamp?: number;
}

export class CircuitBreakerOpenError extends Error {
  readonly breakerName: string;
  readonly retryAfterMs: number;

  constructor(breakerName: string, retryAfterMs: number, reason?: string) {
    super(
      `Circuit breaker '${breakerName}' is OPEN (${reason || "fast-failing upstream dependency"}). Retry in ${Math.ceil(retryAfterMs / 1000)}s.`,
    );
    this.name = "CircuitBreakerOpenError";
    this.breakerName = breakerName;
    this.retryAfterMs = retryAfterMs;
  }
}

export class CircuitBreaker extends EventEmitter {
  readonly name: string;
  private state: CircuitState = "closed";
  private failureCount = 0;
  private consecutiveSuccesses = 0;
  private totalCalls = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private lastStateChange: number = Date.now();
  private lastError?: string;
  private activeHalfOpenTrials = 0;

  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private readonly halfOpenSuccessThreshold: number;
  private readonly halfOpenMaxTrials: number;
  private readonly degradedTimeoutMs: number;
  private readonly isFailurePredicate: (error: unknown) => boolean;

  constructor(options: CircuitBreakerOptions) {
    super();
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? 15_000;
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold ?? 2;
    this.halfOpenMaxTrials = options.halfOpenMaxTrials ?? 2;
    this.degradedTimeoutMs = options.degradedTimeoutMs ?? 10_000;
    this.isFailurePredicate =
      options.isFailure ??
      ((err: any) => {
        // Exclude 4xx user validation errors, trip on 5xx, timeouts, network failures
        if (err && typeof err === "object" && "status" in err) {
          const status = Number((err as any).status);
          return status >= 500 || status === 429 || status === 0;
        }
        return true;
      });
  }

  getState(): CircuitState {
    this.checkAutoRecovery();
    return this.state;
  }

  isOpen(): boolean {
    return this.getState() === "open";
  }

  isClosed(): boolean {
    return this.getState() === "closed";
  }

  isHalfOpen(): boolean {
    return this.getState() === "half_open";
  }

  getMetrics(): CircuitBreakerMetrics {
    this.checkAutoRecovery();
    const nextRetry =
      this.state === "open"
        ? this.lastStateChange + this.recoveryTimeoutMs
        : undefined;

    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.consecutiveSuccesses,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastStateChange: new Date(this.lastStateChange).toISOString(),
      lastError: this.lastError,
      nextRetryTimestamp: nextRetry,
    };
  }

  private checkAutoRecovery(): void {
    if (this.state === "open") {
      const now = Date.now();
      if (now - this.lastStateChange >= this.recoveryTimeoutMs) {
        this.transitionTo(
          "half_open",
          "Recovery cooldown elapsed, attempting trial requests",
        );
      }
    }
  }

  private transitionTo(nextState: CircuitState, reason: string): void {
    if (this.state === nextState) return;

    const previousState = this.state;
    this.state = nextState;
    this.lastStateChange = Date.now();

    if (nextState === "closed") {
      this.failureCount = 0;
      this.consecutiveSuccesses = 0;
      this.activeHalfOpenTrials = 0;
      this.lastError = undefined;
    } else if (nextState === "half_open") {
      this.consecutiveSuccesses = 0;
      this.activeHalfOpenTrials = 0;
    } else if (nextState === "open") {
      this.consecutiveSuccesses = 0;
      this.activeHalfOpenTrials = 0;
    }

    logger.warn(
      {
        breaker: this.name,
        from: previousState,
        to: nextState,
        reason,
      },
      `[CircuitBreaker] State change: ${previousState.toUpperCase()} -> ${nextState.toUpperCase()} (${reason})`,
    );

    this.emit("stateChange", {
      breaker: this.name,
      from: previousState,
      to: nextState,
      reason,
      timestamp: new Date().toISOString(),
    });

    try {
      const reporter = getErrorReporter();
      reporter.captureAgentError(
        new Error(
          `Circuit breaker '${this.name}' transitioned from ${previousState} to ${nextState}: ${reason}`,
        ),
        {
          component: "CircuitBreaker",
          alert: "CIRCUIT_BREAKER_STATE_CHANGE_INCIDENT",
          action: `${previousState}_to_${nextState}`,
          reason,
          extra: {
            breaker: this.name,
            from: previousState,
            to: nextState,
            metrics: this.getMetrics(),
          },
        },
      );
    } catch {
      // Best-effort incident reporting
    }
  }

  async execute<T>(
    action: () => Promise<T>,
    fallback?: (err: Error) => Promise<T> | T,
  ): Promise<T> {
    this.checkAutoRecovery();
    this.totalCalls++;

    if (this.state === "open") {
      const remainingMs = Math.max(
        0,
        this.lastStateChange + this.recoveryTimeoutMs - Date.now(),
      );
      const openErr = new CircuitBreakerOpenError(
        this.name,
        remainingMs,
        this.lastError,
      );

      if (fallback) {
        return fallback(openErr);
      }
      throw openErr;
    }

    if (this.state === "half_open") {
      if (this.activeHalfOpenTrials >= this.halfOpenMaxTrials) {
        const busyErr = new CircuitBreakerOpenError(
          this.name,
          1000,
          "Half-open trial capacity reached",
        );
        if (fallback) return fallback(busyErr);
        throw busyErr;
      }
      this.activeHalfOpenTrials++;
    }

    const t0 = performance.now();
    try {
      const result = await action();
      const elapsedMs = performance.now() - t0;

      if (elapsedMs > this.degradedTimeoutMs) {
        logger.warn(
          {
            breaker: this.name,
            elapsedMs,
            thresholdMs: this.degradedTimeoutMs,
          },
          `[CircuitBreaker] Call succeeded but exceeded latency threshold (${Math.round(elapsedMs)}ms)`,
        );
      }

      this.onCallSuccess();
      return result;
    } catch (err: any) {
      if (this.isFailurePredicate(err)) {
        this.onCallFailure(err);
      }
      if (fallback) {
        return fallback(err);
      }
      throw err;
    } finally {
      if (this.state === "half_open" && this.activeHalfOpenTrials > 0) {
        this.activeHalfOpenTrials--;
      }
    }
  }

  private onCallSuccess(): void {
    this.totalSuccesses++;

    if (this.state === "half_open") {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.halfOpenSuccessThreshold) {
        this.transitionTo(
          "closed",
          `Canary probe succeeded ${this.consecutiveSuccesses} consecutive times`,
        );
      }
    } else if (this.state === "closed") {
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  private onCallFailure(error: any): void {
    this.totalFailures++;
    this.lastError = error?.message || String(error);

    if (this.state === "half_open") {
      this.transitionTo(
        "open",
        `Canary trial failed in half-open state: ${this.lastError}`,
      );
    } else if (this.state === "closed") {
      this.failureCount++;
      if (this.failureCount >= this.failureThreshold) {
        this.transitionTo(
          "open",
          `Failure threshold reached (${this.failureCount}/${this.failureThreshold} errors): ${this.lastError}`,
        );
      }
    }
  }

  trip(reason = "Manually tripped by administrative action"): void {
    this.transitionTo("open", reason);
  }

  reset(): void {
    this.transitionTo("closed", "Manually reset");
  }
}

export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  getOrCreate(
    name: string,
    options: Omit<CircuitBreakerOptions, "name"> = {},
  ): CircuitBreaker {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      breaker = new CircuitBreaker({ name, ...options });
      this.breakers.set(name, breaker);
    }
    return breaker;
  }

  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  getAll(): CircuitBreaker[] {
    return Array.from(this.breakers.values());
  }

  getMetricsSummary(): Record<string, CircuitBreakerMetrics> {
    const summary: Record<string, CircuitBreakerMetrics> = {};
    for (const [name, breaker] of this.breakers.entries()) {
      summary[name] = breaker.getMetrics();
    }
    return summary;
  }

  hasOpenBreakers(): boolean {
    return Array.from(this.breakers.values()).some((b) => b.isOpen());
  }
}

let globalRegistry: CircuitBreakerRegistry | null = null;

export function getCircuitBreakerRegistry(): CircuitBreakerRegistry {
  if (!globalRegistry) {
    globalRegistry = new CircuitBreakerRegistry();
    // Register standard core circuit breakers
    globalRegistry.getOrCreate("openrouter_llm", {
      failureThreshold: 5,
      recoveryTimeoutMs: 20_000,
      halfOpenSuccessThreshold: 2,
    });
    globalRegistry.getOrCreate("executor_core", {
      failureThreshold: 4,
      recoveryTimeoutMs: 15_000,
      halfOpenSuccessThreshold: 2,
    });
    globalRegistry.getOrCreate("rust_grpc", {
      failureThreshold: 3,
      recoveryTimeoutMs: 10_000,
      halfOpenSuccessThreshold: 2,
    });
    globalRegistry.getOrCreate("docker_engine", {
      failureThreshold: 3,
      recoveryTimeoutMs: 15_000,
      halfOpenSuccessThreshold: 2,
    });
  }
  return globalRegistry;
}
