import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { Session } from "./session";
import { SessionManager } from "./session-manager";
import { ToolRegistry } from "../tools/registry";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../provider/provider.interface";
import type { StepRecord } from "../schema/envelope";

class MockProvider implements ModelProvider {
  name = "mock";
  defaultModel = "mock-model";
  private callCount = 0;

  constructor(private responses: ModelResponse[]) {}

  async complete(_request: ModelRequest): Promise<ModelResponse> {
    const res = this.responses[this.callCount] || {
      content: "Default response",
      finishReason: "stop" as const,
    };
    this.callCount++;
    return res;
  }
}

describe("Session Actor", () => {
  it("should create a session with isolated state and default properties", () => {
    const session = new Session({
      sessionId: "custom_session_1",
      title: "Test Session",
      metadata: { userId: "user_123" },
    });

    expect(session.id).toBe("custom_session_1");
    expect(session.title).toBe("Test Session");
    expect(session.getStatus()).toBe("idle");
    expect(session.getMessages().length).toBe(0);
    expect(session.getMetadata().customMetadata).toEqual({
      tenantId: "default",
      namespace: "crucible",
      userId: "user_123",
    });
  });

  it("should emit events during Thought-Action-Observation lifecycle", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "calc",
      description: "math",
      parameters: z.object({ val: z.number() }),
      execute: async ({ val }) => val * 2,
    });

    const mockProvider = new MockProvider([
      {
        thought: "I need to double 21",
        toolCalls: [{ id: "c1", name: "calc", arguments: { val: 21 } }],
        finishReason: "tool_calls",
      },
      {
        thought: "21 doubled is 42",
        content: "The answer is 42.",
        finishReason: "stop",
      },
    ]);

    const session = new Session({
      sessionId: "event_sess",
      provider: mockProvider,
      tools: registry,
    });

    const thoughts: string[] = [];
    const steps: StepRecord[] = [];
    let completedResponse = "";

    session.on("thought", (t) => thoughts.push(t));
    session.on("step", (s) => steps.push(s));
    session.on("done", (res) => {
      completedResponse = res;
    });

    const result = await session.prompt("Double 21");

    expect(result.state).toBe("done");
    expect(completedResponse).toBe("The answer is 42.");
    expect(thoughts).toEqual(["I need to double 21", "21 doubled is 42"]);
    expect(steps.length).toBe(1);
    expect(steps[0].observations[0].output).toBe(42);
    expect(session.getStatus()).toBe("done");
  });

  it("should support multi-turn conversations preserving history", async () => {
    const mockProvider = new MockProvider([
      {
        content: "Hello! How can I help you?",
        finishReason: "stop",
      },
      {
        content: "Sure, your name is Alice.",
        finishReason: "stop",
      },
    ]);

    const session = new Session({
      sessionId: "multi_turn",
      provider: mockProvider,
    });

    // Turn 1
    const res1 = await session.prompt("My name is Alice.");
    expect(res1.finalResponse).toBe("Hello! How can I help you?");
    expect(session.getMessages().length).toBe(2); // user + assistant

    // Turn 2
    const res2 = await session.prompt("What is my name?");
    expect(res2.finalResponse).toBe("Sure, your name is Alice.");
    expect(session.getMessages().length).toBe(4); // user + assistant + user + assistant
    expect(session.getMetadata().turnCount).toBe(2);
  });

  it("should handle human approval required state", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "delete_db",
      description: "danger",
      parameters: z.object({}),
      requiresApproval: true,
      execute: async () => "db deleted",
    });

    const mockProvider = new MockProvider([
      {
        thought: "Deleting database",
        toolCalls: [{ id: "call_del", name: "delete_db", arguments: {} }],
        finishReason: "tool_calls",
      },
      {
        content: "Database operation processed.",
        finishReason: "stop",
      },
    ]);

    let approvalCallsCount = 0;
    const session = new Session({
      sessionId: "approval_sess",
      provider: mockProvider,
      tools: registry,
      onHumanApprovalRequired: async (calls) => {
        approvalCallsCount = calls.length;
        return true; // auto-approve in test handler
      },
    });

    const result = await session.prompt("Delete the db");
    expect(result.state).toBe("done");
    expect(approvalCallsCount).toBe(1);
  });

  it("should automatically derive and save title from the first user prompt", async () => {
    const mockProvider = new MockProvider([
      {
        content: "Comedy is the architecture of laughter.",
        finishReason: "stop",
      },
    ]);

    const session = new Session({
      sessionId: "sess_title_test",
      provider: mockProvider,
    });

    expect(session.title).toBeUndefined();

    let titleChangeEvent = "";
    session.on("titleChange", (t) => {
      titleChangeEvent = t;
    });

    await session.prompt(
      "Comedy: The Architecture of Laughter\nIntroduction\nThe word comedy carries...",
    );

    expect(session.title).toBe("Comedy: The Architecture of Laughter");
    expect(titleChangeEvent).toBe("Comedy: The Architecture of Laughter");
    expect(session.getMetadata().title).toBe(
      "Comedy: The Architecture of Laughter",
    );
    expect(session.getMetadata().customMetadata?.messages).toBeDefined();
  });
});

describe("SessionManager Multiton Registry", () => {
  it("should create, retrieve, list, and delete isolated sessions", () => {
    const manager = new SessionManager();

    const sessA = manager.createSession({
      sessionId: "sess_a",
      title: "Session A",
    });
    const sessB = manager.createSession({
      sessionId: "sess_b",
      title: "Session B",
    });

    expect(manager.count()).toBe(2);
    expect(manager.has("sess_a")).toBe(true);
    expect(manager.has("sess_b")).toBe(true);
    expect(manager.get("sess_a")).toBe(sessA);
    expect(manager.getOrThrow("sess_b")).toBe(sessB);

    const summaries = manager.list();
    expect(summaries.length).toBe(2);
    expect(summaries.map((s) => s.id).sort()).toEqual(["sess_a", "sess_b"]);

    const deleted = manager.delete("sess_a");
    expect(deleted).toBe(true);
    expect(manager.count()).toBe(1);
    expect(manager.has("sess_a")).toBe(false);

    manager.clear();
    expect(manager.count()).toBe(0);
  });

  it("should ensure strict state isolation between concurrent sessions", async () => {
    const manager = new SessionManager();

    const providerA = new MockProvider([
      { content: "Response from Session A", finishReason: "stop" },
    ]);
    const providerB = new MockProvider([
      { content: "Response from Session B", finishReason: "stop" },
    ]);

    const sessA = manager.createSession({
      sessionId: "isolated_a",
      provider: providerA,
    });
    const sessB = manager.createSession({
      sessionId: "isolated_b",
      provider: providerB,
    });

    await Promise.all([
      sessA.prompt("Prompt for A"),
      sessB.prompt("Prompt for B"),
    ]);

    expect(sessA.getMessages().length).toBe(2);
    expect(sessA.getMessages()[0].content).toBe("Prompt for A");
    expect(sessA.getMessages()[1].content).toBe("Response from Session A");

    expect(sessB.getMessages().length).toBe(2);
    expect(sessB.getMessages()[0].content).toBe("Prompt for B");
    expect(sessB.getMessages()[1].content).toBe("Response from Session B");
  });

  it("should enforce max concurrent session limits", () => {
    const manager = new SessionManager({ maxConcurrentSessions: 2 });

    manager.createSession({ sessionId: "s1" });
    manager.createSession({ sessionId: "s2" });

    expect(() => manager.createSession({ sessionId: "s3" })).toThrow(
      /Session limit reached/,
    );
  });

  it("should forward lifecycle events from sessions", () => {
    const manager = new SessionManager();
    const createdEvents: string[] = [];
    const stateEvents: string[] = [];

    manager.on("sessionCreated", (summary) => createdEvents.push(summary.id));
    manager.on("sessionStateChange", (id, state) =>
      stateEvents.push(`${id}:${state}`),
    );

    const sess = manager.createSession({ sessionId: "event_target" });
    expect(createdEvents).toEqual(["event_target"]);

    sess.dispose();
  });
});
