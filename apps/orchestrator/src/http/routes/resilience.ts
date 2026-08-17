import { getCircuitBreakerRegistry } from "../../resilience/circuit-breaker";
import { getRateLimiter } from "../../resilience/rate-limiter";
import { getCostMeter } from "../../resilience/cost-meter";

export class ResilienceRouteHandler {
  async getStatus(): Promise<Response> {
    const cbRegistry = getCircuitBreakerRegistry();
    const _rateLimiter = getRateLimiter();
    const _costMeter = getCostMeter();

    const breakers = cbRegistry.getAll().map((b) => b.getMetrics());
    const hasOpenBreakers = cbRegistry.hasOpenBreakers();

    return new Response(
      JSON.stringify({
        status: hasOpenBreakers ? "degraded" : "ok",
        hasOpenBreakers,
        breakers,
        rateLimiter: {
          sessionCapacity: 30,
          tenantCapacity: 120,
          globalCapacity: 300,
        },
        costMeter: {
          maxCostPerRunUsd: 2.0,
          maxCostPerSessionUsd: 20.0,
        },
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }

  async resetBreaker(name: string): Promise<Response> {
    const cbRegistry = getCircuitBreakerRegistry();
    const breaker = cbRegistry.get(name);

    if (!breaker) {
      return new Response(
        JSON.stringify({
          status: "error",
          error: {
            code: "CIRCUIT_BREAKER_NOT_FOUND",
            message: `Circuit breaker '${name}' not found.`,
          },
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }

    breaker.reset();

    return new Response(
      JSON.stringify({
        status: "ok",
        message: `Circuit breaker '${name}' reset to closed.`,
        metrics: breaker.getMetrics(),
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }

  async tripBreaker(name: string, reason?: string): Promise<Response> {
    const cbRegistry = getCircuitBreakerRegistry();
    const breaker = cbRegistry.get(name);

    if (!breaker) {
      return new Response(
        JSON.stringify({
          status: "error",
          error: {
            code: "CIRCUIT_BREAKER_NOT_FOUND",
            message: `Circuit breaker '${name}' not found.`,
          },
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }

    breaker.trip(reason || "Admin triggered circuit breaker trip");

    return new Response(
      JSON.stringify({
        status: "ok",
        message: `Circuit breaker '${name}' manually tripped to open.`,
        metrics: breaker.getMetrics(),
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }
}
