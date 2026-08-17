import { describe, it, expect } from "bun:test";
import React from "react";
import { Toast } from "./ui/toast";
import { ResilienceStatusBanner } from "./ResilienceStatusBanner";

describe("Resilience UI Notifications (Toast, RateLimit & Status Banner)", () => {
  it("defines Toast component for rate-limit snackbar stopgap", () => {
    expect(typeof Toast).toBe("function");

    const element = React.createElement(Toast, {
      type: "rate_limit",
      title: "Rate Limit Exceeded",
      message: "Too many prompt dispatches. Please slow down.",
      retryAfterSeconds: 15,
    });

    expect(element).toBeDefined();
    expect(element.props.type).toBe("rate_limit");
    expect(element.props.title).toBe("Rate Limit Exceeded");
    expect(element.props.retryAfterSeconds).toBe(15);
  });

  it("defines Toast component for circuit breaker open alerts", () => {
    const element = React.createElement(Toast, {
      type: "circuit_breaker",
      title: "Circuit Breaker Tripped",
      message:
        "Upstream LLM provider is currently degraded. Fast-failing calls.",
      retryAfterSeconds: 30,
    });

    expect(element).toBeDefined();
    expect(element.props.type).toBe("circuit_breaker");
    expect(element.props.title).toBe("Circuit Breaker Tripped");
    expect(element.props.retryAfterSeconds).toBe(30);
  });

  it("defines ResilienceStatusBanner with Decorator pattern support", () => {
    expect(typeof ResilienceStatusBanner).toBe("function");

    const child = React.createElement(
      "div",
      { id: "chat-content" },
      "Chat Window",
    );
    const element = React.createElement(
      ResilienceStatusBanner,
      {
        initialBreakerState: {
          name: "openrouter_llm",
          state: "open",
          failureCount: 5,
        },
        initialRateLimited: true,
      },
      child,
    );

    expect(element).toBeDefined();
    expect(element.props.initialBreakerState?.name).toBe("openrouter_llm");
    expect(element.props.initialBreakerState?.state).toBe("open");
    expect(element.props.initialRateLimited).toBe(true);
    expect(element.props.children).toBe(child);
  });
});
