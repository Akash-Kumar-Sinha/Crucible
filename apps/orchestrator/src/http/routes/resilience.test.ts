import { describe, it, expect } from "bun:test";
import { ResilienceRouteHandler } from "./resilience";
import { getCircuitBreakerRegistry } from "../../resilience/circuit-breaker";

describe("ResilienceRouteHandler (REST API)", () => {
  const handler = new ResilienceRouteHandler();

  it("returns cluster resilience status on GET /resilience/status", async () => {
    const res = await handler.getStatus();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBeDefined();
    expect(Array.isArray(data.breakers)).toBe(true);
    expect(data.rateLimiter).toBeDefined();
    expect(data.costMeter).toBeDefined();
  });

  it("trips and resets circuit breakers via REST endpoints", async () => {
    const registry = getCircuitBreakerRegistry();
    registry.getOrCreate("test_breaker");

    // Trip
    const tripRes = await handler.tripBreaker("test_breaker", "Chaos test");
    expect(tripRes.status).toBe(200);
    const tripData = await tripRes.json();
    expect(tripData.metrics.state).toBe("open");

    // Reset
    const resetRes = await handler.resetBreaker("test_breaker");
    expect(resetRes.status).toBe(200);
    const resetData = await resetRes.json();
    expect(resetData.metrics.state).toBe("closed");
  });

  it("returns 404 when resetting non-existent breaker", async () => {
    const res = await handler.resetBreaker("non_existent_breaker_xyz");
    expect(res.status).toBe(404);
  });
});
