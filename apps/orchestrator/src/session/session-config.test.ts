import { describe, it, expect } from "bun:test";
import { SessionConfigSchema, resolveSessionConfig } from "./session-config";
import { Session } from "./session";
import { MockModelProvider } from "../provider/mock";

describe("Per-Session Model Selection & Config", () => {
  it("should validate and parse valid session config schemas", () => {
    const validConfig = {
      model: "anthropic/claude-3.5-sonnet",
      systemPrompt: "You are an autonomous coding specialist.",
      temperature: 0.7,
      maxSteps: 50,
      tenantId: "tenant_alpha",
      namespace: "engineering",
    };

    const parsed = SessionConfigSchema.parse(validConfig);
    expect(parsed.model).toBe("anthropic/claude-3.5-sonnet");
    expect(parsed.temperature).toBe(0.7);
    expect(parsed.maxSteps).toBe(50);
  });

  it("should resolve defaults when model or configuration parameters are omitted", () => {
    const resolved = resolveSessionConfig(
      {},
      { defaultModel: "google/gemini-2.0-flash-exp:free" },
    );

    expect(resolved.model).toBe("google/gemini-2.0-flash-exp:free");
    expect(resolved.temperature).toBe(0.2);
    expect(resolved.maxSteps).toBe(25);
    expect(resolved.metadata?.model).toBe("google/gemini-2.0-flash-exp:free");
  });

  it("should bind distinct models to individual Session instances (Strategy pattern)", () => {
    const mockProvider = new MockModelProvider();

    const sessionA = new Session({
      sessionId: "sess_claude_role",
      model: "anthropic/claude-3.5-sonnet",
      provider: mockProvider,
    });

    const sessionB = new Session({
      sessionId: "sess_deepseek_role",
      model: "deepseek/deepseek-chat",
      provider: mockProvider,
    });

    expect(sessionA.getModel()).toBe("anthropic/claude-3.5-sonnet");
    expect(sessionB.getModel()).toBe("deepseek/deepseek-chat");

    const summaryA = sessionA.getSummary();
    const summaryB = sessionB.getSummary();

    expect(summaryA.metadata.model).toBe("anthropic/claude-3.5-sonnet");
    expect(summaryB.metadata.model).toBe("deepseek/deepseek-chat");
  });
});
