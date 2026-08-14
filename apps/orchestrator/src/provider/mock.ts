import type { ModelProvider, ModelRequest, ModelResponse } from "./provider.interface";
import type { ToolCall } from "../schema/envelope";

export class MockModelProvider implements ModelProvider {
  readonly name = "mock";
  readonly defaultModel = "mock-agent";

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const messages = request.messages;
    const lastMessage = messages[messages.length - 1];

    // If the last message was a tool observation, summarize the final answer
    if (lastMessage?.role === "tool") {
      const toolOutput = lastMessage.content;
      return {
        thought: "I have observed the tool output and am ready to formulate the final answer.",
        content: `Based on the tool execution result: ${toolOutput}`,
        finishReason: "stop",
      };
    }

    const userText = (lastMessage?.content || "").toLowerCase();

    // Check if the user prompt involves math
    if (
      userText.includes("*") ||
      userText.includes("+") ||
      userText.includes("/") ||
      userText.includes("calculate") ||
      userText.includes("math")
    ) {
      const match = userText.match(/(\d+\s*[\*\+\-\/]\s*\d+)/);
      const expression = match ? match[1].replace(/\s+/g, "") : "345 * 25";
      const toolCall: ToolCall = {
        id: `call_calc_${Date.now()}`,
        name: "calculator",
        arguments: { expression },
      };

      return {
        thought: `The user is asking a mathematical calculation. I will use the calculator tool to evaluate '${expression}'.`,
        toolCalls: [toolCall],
        finishReason: "tool_calls",
      };
    }

    // Check if the user asks for time
    if (userText.includes("time") || userText.includes("date") || userText.includes("day")) {
      const toolCall: ToolCall = {
        id: `call_time_${Date.now()}`,
        name: "get_current_time",
        arguments: {},
      };

      return {
        thought: "The user requested the current time. I will invoke get_current_time.",
        toolCalls: [toolCall],
        finishReason: "tool_calls",
      };
    }

    // Default conversational response
    return {
      thought: `Received user prompt: "${lastMessage?.content}". Formulating autonomous reasoning plan.`,
      content: `Hello! I am Crucible running in local mock mode. You asked: "${lastMessage?.content}". How can I help you further?`,
      finishReason: "stop",
    };
  }
}
