import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { AgentStateMachine } from "./state-machine";
import { AgentLoop } from "./loop";
import { ToolRegistry } from "../tools/registry";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../provider/provider.interface";

// Mock Provider for deterministic tests
class MockProvider implements ModelProvider {
  name = "mock";
  defaultModel = "mock-model";
  private stepIndex = 0;

  constructor(private responses: ModelResponse[]) {}

  async complete(_request: ModelRequest): Promise<ModelResponse> {
    const res = this.responses[this.stepIndex] || {
      content: "Default mock response",
      finishReason: "stop" as const,
    };
    this.stepIndex++;
    return res;
  }
}

describe("Agent State Machine", () => {
  it("should initialize in awaiting_model state", () => {
    const sm = new AgentStateMachine();
    expect(sm.getState()).toBe("awaiting_model");
  });

  it("should transition from awaiting_model -> awaiting_tool -> awaiting_model -> done", () => {
    const sm = new AgentStateMachine({ initialPrompt: "Calculate 2 + 2" });
    const transitions: string[] = [];

    sm.onTransition((from, to) => {
      transitions.push(`${from}->${to}`);
    });

    // Step 1: Model requests a tool call
    sm.send({
      type: "MODEL_RESPONSE",
      response: {
        thought: "I need to use the calculator tool",
        toolCalls: [
          {
            id: "call_1",
            name: "calculator",
            arguments: { expression: "2 + 2" },
          },
        ],
        finishReason: "tool_calls",
      },
    });

    expect(sm.getState()).toBe("awaiting_tool");

    // Step 2: Tool execution finishes with observation
    sm.send({
      type: "TOOL_RESULTS",
      results: [
        {
          toolCallId: "call_1",
          name: "calculator",
          status: "success",
          output: { result: 4 },
          metadata: { timestamp: Date.now() },
        },
      ],
    });

    expect(sm.getState()).toBe("awaiting_model");

    // Step 3: Model receives observation and outputs final answer
    sm.send({
      type: "MODEL_RESPONSE",
      response: {
        thought: "The result is 4. I can now answer the user.",
        content: "2 + 2 is 4.",
        finishReason: "stop",
      },
    });

    expect(sm.getState()).toBe("done");
    expect(sm.getContext().finalResponse).toBe("2 + 2 is 4.");
    expect(transitions).toEqual([
      "awaiting_model->awaiting_tool",
      "awaiting_tool->awaiting_model",
      "awaiting_model->done",
    ]);
  });

  it("should handle awaiting_human state and user approval/rejection", () => {
    const sm = new AgentStateMachine();

    // Model requests sensitive tool
    sm.send({
      type: "MODEL_RESPONSE",
      response: {
        thought: "Deleting sensitive file",
        toolCalls: [
          {
            id: "call_danger",
            name: "dangerous_exec",
            arguments: { cmd: "rm" },
          },
        ],
        finishReason: "tool_calls",
      },
      hasHumanApprovalRequired: true,
    });

    expect(sm.getState()).toBe("awaiting_human");

    // User rejects the action
    sm.send({
      type: "HUMAN_REJECTED",
      toolCallId: "call_danger",
      reason: "Permission denied by admin",
    });

    expect(sm.getState()).toBe("awaiting_model");
    const lastMsg =
      sm.getContext().messages[sm.getContext().messages.length - 1];
    expect(lastMsg.role).toBe("tool");
    expect(lastMsg.content).toContain("Permission denied by admin");
  });
});

describe("Tool Registry with Zod Envelopes", () => {
  it("should validate tool arguments and execute successfully", async () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "greet",
      description: "Greets a person",
      parameters: z.object({
        name: z.string(),
      }),
      execute: async ({ name }) => ({ greeting: `Hello, ${name}!` }),
    });

    const result = await registry.execute(
      { id: "call_1", name: "greet", arguments: { name: "Crucible" } },
      { sessionId: "s1", step: 1 },
    );

    expect(result.status).toBe("success");
    expect(result.output).toEqual({ greeting: "Hello, Crucible!" });
  });

  it("should return error result when Zod validation fails", async () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "square",
      description: "Squares a number",
      parameters: z.object({
        num: z.number(),
      }),
      execute: async ({ num }) => ({ result: num * num }),
    });

    const result = await registry.execute(
      {
        id: "call_2",
        name: "square",
        arguments: { num: "not_a_number" as any },
      },
      { sessionId: "s1", step: 1 },
    );

    expect(result.status).toBe("error");
    expect(result.error?.message).toContain("Expected number");
  });
});

describe("AgentLoop Runner (Thought-Action-Observation)", () => {
  it("should run full autonomous loop with mock provider strategy", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "add",
      description: "Adds numbers",
      parameters: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => a + b,
    });

    const mockProvider = new MockProvider([
      // Step 1: Model calls tool
      {
        thought: "Thinking: need to add 5 + 10",
        toolCalls: [{ id: "c1", name: "add", arguments: { a: 5, b: 10 } }],
        finishReason: "tool_calls",
      },
      // Step 2: Model gives final answer
      {
        thought: "Thinking: 5 + 10 is 15",
        content: "The sum of 5 and 10 is 15.",
        finishReason: "stop",
      },
    ]);

    const loop = new AgentLoop({
      provider: mockProvider,
      tools: registry,
    });

    const result = await loop.run("Add 5 and 10");

    expect(result.state).toBe("done");
    expect(result.finalResponse).toBe("The sum of 5 and 10 is 15.");
    expect(result.history.length).toBe(2);
    expect(result.history[0].actions[0].name).toBe("add");
    expect(result.history[0].observations[0].output).toBe(15);
  });
});
