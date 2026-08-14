import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { ToolRegistry } from "./registry";
import { AgentLoop } from "../agent/loop";
import {
  ENVELOPE_VERSION_V1,
  createToolCallV1,
} from "@crucible/shared-schemas";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../provider/provider.interface";

describe("Tool Schema Validation & Envelope Contracts", () => {
  const dummySchema = z.object({
    orderId: z.string().startsWith("ORD-"),
    quantity: z.number().int().min(1).max(100),
    priority: z.enum(["low", "medium", "high"]),
  });

  const registry = new ToolRegistry().register({
    name: "dummy_order_processor",
    description: "Order processor with strict constraints",
    parameters: dummySchema,
    execute: async ({ orderId, quantity, priority }) => ({
      status: "PROCESSED",
      orderId,
      quantity,
      priority,
    }),
  });

  it("should validate good args and return a success envelope with exact v1 shape", async () => {
    const call = createToolCallV1({
      callId: "call_ok_123",
      toolName: "dummy_order_processor",
      input: { orderId: "ORD-999", quantity: 10, priority: "high" },
    });

    const result = await registry.execute(call, { sessionId: "s1", step: 1 });

    expect(result.version).toBe(ENVELOPE_VERSION_V1);
    expect(result.callId).toBe("call_ok_123");
    expect(result.toolName).toBe("dummy_order_processor");
    expect(result.status).toBe("success");
    expect(result.output).toEqual({
      status: "PROCESSED",
      orderId: "ORD-999",
      quantity: 10,
      priority: "high",
    });
    expect(result.error).toBeUndefined();
    expect(typeof result.durationMs).toBe("number");
    expect(typeof result.timestamp).toBe("number");
  });

  it("should fail validation on bad args with structured error envelope (not silently pass)", async () => {
    const badCall = createToolCallV1({
      callId: "call_err_456",
      toolName: "dummy_order_processor",
      input: {
        orderId: "INVALID_PREFIX",
        quantity: -50,
        priority: "super_fast" as any,
      },
    });

    const result = await registry.execute(badCall, {
      sessionId: "s1",
      step: 1,
    });

    expect(result.version).toBe(ENVELOPE_VERSION_V1);
    expect(result.callId).toBe("call_err_456");
    expect(result.toolName).toBe("dummy_order_processor");
    expect(result.status).toBe("error");
    expect(result.error?.code).toBe("INVALID_PARAMETERS");
    expect(result.error?.message).toContain("Invalid input parameters");
    expect(result.error?.details).toBeDefined();
    expect(result.output).toBeUndefined();
  });

  it("should execute dummy tool inside AgentLoop and observe result in message history", async () => {
    class MockToolTriggerProvider implements ModelProvider {
      name = "mock_provider";
      defaultModel = "mock";
      private callCount = 0;

      async complete(_req: ModelRequest): Promise<ModelResponse> {
        this.callCount++;
        if (this.callCount === 1) {
          return {
            thought: "Invoking dummy tool",
            toolCalls: [
              {
                id: "call_in_loop",
                name: "dummy_order_processor",
                arguments: { orderId: "ORD-42", quantity: 1, priority: "low" },
              },
            ],
            finishReason: "tool_calls",
          };
        }
        return {
          thought: "Done",
          content: "Order ORD-42 completed.",
          finishReason: "stop",
        };
      }
    }

    const loop = new AgentLoop({
      provider: new MockToolTriggerProvider(),
      tools: registry,
    });

    const result = await loop.run("Process order ORD-42");
    expect(result.state).toBe("done");
    expect(result.finalResponse).toBe("Order ORD-42 completed.");

    const messages = loop.getContext().messages;
    const toolResultMsg = messages.find((m) => m.role === "tool");
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg?.toolCallId).toBe("call_in_loop");
    expect(toolResultMsg?.content).toContain("PROCESSED");
  });
});
