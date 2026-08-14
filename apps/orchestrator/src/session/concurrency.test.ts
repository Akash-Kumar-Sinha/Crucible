import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { SessionManager } from "./session-manager";
import { ToolRegistry } from "../tools/registry";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../provider/provider.interface";

class MockIsolatedProvider implements ModelProvider {
  name = "mock_isolated";
  defaultModel = "mock";

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const lastMsg = request.messages[request.messages.length - 1];

    if (lastMsg.role === "user") {
      if (lastMsg.content.includes("Calculate")) {
        return {
          thought: "Need to run math",
          toolCalls: [{ id: "c_math", name: "calc", arguments: { expr: "100 + 200" } }],
          finishReason: "tool_calls",
        };
      }
      if (lastMsg.content.includes("Time")) {
        return {
          thought: "Need to get time",
          toolCalls: [{ id: "c_time", name: "time", arguments: {} }],
          finishReason: "tool_calls",
        };
      }
      if (lastMsg.content.includes("Capital")) {
        return {
          thought: "Direct knowledge lookup",
          content: "The capital of France is Paris.",
          finishReason: "stop",
        };
      }
    } else if (lastMsg.role === "tool") {
      if (lastMsg.name === "calc") {
        return {
          thought: "Calculation finished",
          content: "100 + 200 is 300.",
          finishReason: "stop",
        };
      }
      if (lastMsg.name === "time") {
        return {
          thought: "Time fetched",
          content: "The time is 12:00:00 UTC.",
          finishReason: "stop",
        };
      }
    }

    return { content: "Fallback response", finishReason: "stop" };
  }
}

describe("Multi-Session Concurrency & Strict Isolation Test", () => {
  it("should run 3 concurrent sessions with different messages and zero state/history cross-talk", async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: "calc",
      description: "calc",
      parameters: z.object({ expr: z.string() }),
      execute: async () => ({ result: 300 }),
    });
    tools.register({
      name: "time",
      description: "time",
      parameters: z.object({}),
      execute: async () => ({ iso: "2026-08-14T12:00:00Z" }),
    });

    const manager = new SessionManager({
      defaultProvider: new MockIsolatedProvider(),
      defaultTools: tools,
    });

    const s1 = manager.createSession({ sessionId: "sess_math", title: "Math Session" });
    const s2 = manager.createSession({ sessionId: "sess_time", title: "Time Session" });
    const s3 = manager.createSession({ sessionId: "sess_geo", title: "Geography Session" });

    // Track states independently
    const states: Record<string, string[]> = {
      sess_math: [],
      sess_time: [],
      sess_geo: [],
    };

    s1.on("stateChange", (to) => states.sess_math.push(to));
    s2.on("stateChange", (to) => states.sess_time.push(to));
    s3.on("stateChange", (to) => states.sess_geo.push(to));

    // Send 3 distinct prompts concurrently
    const [res1, res2, res3] = await Promise.all([
      s1.prompt("Calculate 100 + 200"),
      s2.prompt("What is the Time?"),
      s3.prompt("What is the Capital of France?"),
    ]);

    // Verify terminal completion
    expect(res1.state).toBe("done");
    expect(res2.state).toBe("done");
    expect(res3.state).toBe("done");

    expect(res1.finalResponse).toBe("100 + 200 is 300.");
    expect(res2.finalResponse).toBe("The time is 12:00:00 UTC.");
    expect(res3.finalResponse).toBe("The capital of France is Paris.");

    // Verify Message Isolation: s1 has only math messages
    const msgs1 = s1.getMessages();
    expect(msgs1.length).toBe(4); // user prompt, assistant tool_call, tool response, assistant final
    expect(msgs1.some((m) => m.content.includes("Calculate 100 + 200"))).toBe(true);
    expect(msgs1.some((m) => m.content.includes("Time") || m.content.includes("Capital"))).toBe(false);

    // Verify Message Isolation: s2 has only time messages
    const msgs2 = s2.getMessages();
    expect(msgs2.length).toBe(4); // user prompt, assistant tool_call, tool response, assistant final
    expect(msgs2.some((m) => m.content.includes("Time"))).toBe(true);
    expect(msgs2.some((m) => m.content.includes("Calculate") || m.content.includes("Capital"))).toBe(false);

    // Verify Message Isolation: s3 has only geography messages
    const msgs3 = s3.getMessages();
    expect(msgs3.length).toBe(2); // user prompt, assistant final (no tool)
    expect(msgs3.some((m) => m.content.includes("Capital"))).toBe(true);
    expect(msgs3.some((m) => m.content.includes("Calculate") || m.content.includes("Time"))).toBe(false);

    // Verify Step History Isolation
    expect(s1.getHistory().length).toBe(2);
    expect(s2.getHistory().length).toBe(2);
    expect(s3.getHistory().length).toBe(1);

    expect(s1.getHistory()[0].actions[0].name).toBe("calc");
    expect(s2.getHistory()[0].actions[0].name).toBe("time");
    expect(s3.getHistory()[0].actions.length).toBe(0);
  });
});
