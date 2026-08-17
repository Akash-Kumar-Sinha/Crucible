import { describe, it, expect } from "bun:test";
import { CostMeter, CostLimitExceededError } from "./cost-meter";

describe("CostMeter (Financial Safety & Resource Metering)", () => {
  it("calculates prompt and completion USD costs accurately for model catalogs", () => {
    const meter = new CostMeter();

    // Anthropic Claude 3.5 Sonnet: $3 / 1M prompt ($0.003 / 1k), $15 / 1M completion ($0.015 / 1k)
    const cost = meter.calculateCost("anthropic/claude-3.5-sonnet", {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });

    expect(cost.promptCost).toBe(0.003);
    expect(cost.completionCost).toBe(0.0075);
    expect(cost.totalCost).toBe(0.0105);
  });

  it("applies cached token discounts", () => {
    const meter = new CostMeter();

    const cost = meter.calculateCost("anthropic/claude-3.5-sonnet", {
      promptTokens: 2000,
      cachedTokens: 1000,
      completionTokens: 0,
      totalTokens: 2000,
    });

    // 1000 non-cached = 0.003, 1000 cached @ 50% = 0.0015 -> total = 0.0045
    expect(cost.promptCost).toBe(0.0045);
  });

  it("records usage history and computes aggregate session totals", () => {
    const meter = new CostMeter();

    meter.recordUsage(
      "sess_alpha",
      "anthropic/claude-3.5-sonnet",
      { promptTokens: 1000, completionTokens: 200, totalTokens: 1200 },
      1,
    );
    meter.recordUsage(
      "sess_alpha",
      "anthropic/claude-3.5-sonnet",
      { promptTokens: 2000, completionTokens: 400, totalTokens: 2400 },
      2,
    );

    const summary = meter.getSessionCost("sess_alpha");
    expect(summary.totalPromptTokens).toBe(3000);
    expect(summary.totalCompletionTokens).toBe(600);
    expect(summary.totalTokens).toBe(3600);
    expect(summary.records.length).toBe(2);
    expect(summary.totalCostUsd).toBeGreaterThan(0);
  });

  it("throws CostLimitExceededError when per-run cost cap is breached", () => {
    const meter = new CostMeter({ maxCostPerRunUsd: 0.05 });

    // 50,000 prompt tokens on Sonnet ($0.15) > $0.05 cap
    expect(() => {
      meter.recordUsage(
        "sess_heavy",
        "anthropic/claude-3.5-sonnet",
        { promptTokens: 50000, completionTokens: 0, totalTokens: 50000 },
        1,
      );
    }).toThrow(CostLimitExceededError);
  });
});
