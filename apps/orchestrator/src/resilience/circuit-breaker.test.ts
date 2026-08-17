import { describe, it, expect } from "bun:test";
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  CircuitBreakerRegistry,
} from "./circuit-breaker";

describe("CircuitBreaker (Resilience Pattern)", () => {
  it("starts in CLOSED state and executes actions normally", async () => {
    const breaker = new CircuitBreaker({
      name: "test_service",
      failureThreshold: 3,
      recoveryTimeoutMs: 200,
    });

    expect(breaker.getState()).toBe("closed");
    expect(breaker.isClosed()).toBe(true);

    const result = await breaker.execute(async () => "success_payload");
    expect(result).toBe("success_payload");

    const metrics = breaker.getMetrics();
    expect(metrics.totalCalls).toBe(1);
    expect(metrics.totalSuccesses).toBe(1);
    expect(metrics.totalFailures).toBe(0);
  });

  it("trips from CLOSED to OPEN when failure threshold is reached", async () => {
    const breaker = new CircuitBreaker({
      name: "failing_llm",
      failureThreshold: 3,
      recoveryTimeoutMs: 500,
    });

    const stateChanges: any[] = [];
    breaker.on("stateChange", (evt) => stateChanges.push(evt));

    // 3 consecutive failures
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("503 Service Unavailable");
        });
      } catch (err: any) {
        expect(err).toBeDefined();
      }
    }

    expect(breaker.getState()).toBe("open");
    expect(breaker.isOpen()).toBe(true);
    expect(stateChanges.length).toBe(1);
    expect(stateChanges[0].from).toBe("closed");
    expect(stateChanges[0].to).toBe("open");

    // Next call fails fast without calling action
    let actionInvoked = false;
    try {
      await breaker.execute(async () => {
        actionInvoked = true;
        return "not_reached";
      });
      expect(true).toBe(false); // Should throw
    } catch (err: any) {
      expect(err).toBeInstanceOf(CircuitBreakerOpenError);
      expect(err.message).toContain("is OPEN");
      expect(actionInvoked).toBe(false);
    }
  });

  it("transitions to HALF_OPEN after recovery timeout and closes upon success", async () => {
    const breaker = new CircuitBreaker({
      name: "recovering_service",
      failureThreshold: 2,
      recoveryTimeoutMs: 50, // fast cooldown for test
      halfOpenSuccessThreshold: 2,
    });

    // Trip the breaker
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error("Down");
        });
      } catch (err: any) {
        expect(err).toBeDefined();
      }
    }
    expect(breaker.isOpen()).toBe(true);

    // Wait for recovery cooldown
    await new Promise((r) => setTimeout(r, 60));

    // Canary probe 1
    const res1 = await breaker.execute(async () => "probe_1_ok");
    expect(res1).toBe("probe_1_ok");
    expect(breaker.getState()).toBe("half_open");

    // Canary probe 2
    const res2 = await breaker.execute(async () => "probe_2_ok");
    expect(res2).toBe("probe_2_ok");

    // Circuit should now be CLOSED
    expect(breaker.getState()).toBe("closed");
    expect(breaker.isClosed()).toBe(true);
  });

  it("uses fallback handler when circuit is open or call fails", async () => {
    const breaker = new CircuitBreaker({
      name: "fallback_service",
      failureThreshold: 1,
      recoveryTimeoutMs: 500,
    });

    breaker.trip("Forced trip");

    const fallbackResult = await breaker.execute(
      async () => "primary",
      async (err) => `fallback_recovered: ${err.message}`,
    );

    expect(fallbackResult).toContain("fallback_recovered");
  });

  it("manages registry of named circuit breakers", () => {
    const registry = new CircuitBreakerRegistry();
    const b1 = registry.getOrCreate("openrouter_llm", { failureThreshold: 5 });
    const b2 = registry.getOrCreate("openrouter_llm");

    expect(b1).toBe(b2);
    expect(registry.getAll().length).toBe(1);
    expect(registry.hasOpenBreakers()).toBe(false);

    b1.trip("Test trip");
    expect(registry.hasOpenBreakers()).toBe(true);
  });
});
