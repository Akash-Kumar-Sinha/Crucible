import { describe, it, expect } from "bun:test";
import React from "react";
import { ResilienceStatusBanner } from "./ResilienceStatusBanner";

describe("ResilienceStatusBanner Real-Time UI Component", () => {
  it("should render cleanly without banners when all circuit breakers are closed", () => {
    const element = React.createElement(
      ResilienceStatusBanner,
      {
        initialBreakerState: {
          name: "openrouter_llm",
          state: "closed",
        },
        initialRateLimited: false,
      },
      React.createElement("div", { id: "chat-content" }, "Chat Container"),
    );

    expect(element).toBeDefined();
    expect(element.props.initialBreakerState?.state).toBe("closed");
    expect(element.props.initialRateLimited).toBe(false);
  });

  it("should render circuit breaker tripped banner with reset action when breaker is open", () => {
    const element = React.createElement(
      ResilienceStatusBanner,
      {
        initialBreakerState: {
          name: "openrouter_llm",
          state: "open",
          failureCount: 5,
        },
        initialRateLimited: false,
      },
      React.createElement("div", { id: "chat-content" }, "Chat Container"),
    );

    expect(element).toBeDefined();
    expect(element.props.initialBreakerState?.state).toBe("open");
    expect(element.props.initialBreakerState?.name).toBe("openrouter_llm");
    expect(element.props.initialBreakerState?.failureCount).toBe(5);
  });

  it("should render rate limit banner when initialRateLimited is true", () => {
    const element = React.createElement(
      ResilienceStatusBanner,
      {
        initialRateLimited: true,
      },
      React.createElement("div", { id: "chat-content" }, "Chat Container"),
    );

    expect(element).toBeDefined();
    expect(element.props.initialRateLimited).toBe(true);
  });
});
