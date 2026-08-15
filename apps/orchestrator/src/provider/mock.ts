import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "./provider.interface";
import type { ToolCall } from "../schema/envelope";

export class MockModelProvider implements ModelProvider {
  readonly name = "mock";
  readonly defaultModel = "mock-agent";
  private queuedResponses: ModelResponse[] = [];

  setNextResponse(response: Partial<ModelResponse>): this {
    this.queuedResponses.push({
      content: response.content ?? "",
      thought: response.thought,
      toolCalls: response.toolCalls,
      finishReason:
        response.finishReason ?? (response.toolCalls ? "tool_calls" : "stop"),
      usage: response.usage,
    });
    return this;
  }

  private emitStream(response: ModelResponse, request: ModelRequest): void {
    if (response.thought && request.onThought) {
      const words = response.thought.split(" ");
      for (let i = 0; i < words.length; i++) {
        const token = (i > 0 ? " " : "") + words[i];
        request.onThought(token);
      }
    }
    if (response.content && request.onToken) {
      const words = response.content.split(" ");
      for (let i = 0; i < words.length; i++) {
        const token = (i > 0 ? " " : "") + words[i];
        request.onToken(token);
      }
    }
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    let result: ModelResponse;

    if (this.queuedResponses.length > 0) {
      result = this.queuedResponses.shift()!;
      this.emitStream(result, request);
      return result;
    }

    const messages = request.messages;
    const lastMessage = messages[messages.length - 1];

    if (lastMessage?.role === "tool") {
      const toolOutput = lastMessage.content;
      result = {
        thought:
          "I have observed the tool output and am ready to formulate the final answer.",
        content: `Based on the tool execution result: ${toolOutput}`,
        finishReason: "stop",
      };
      this.emitStream(result, request);
      return result;
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
      const match = userText.match(/(\d+\s*[-*+/]\s*\d+)/);
      const expression = match ? match[1].replace(/\s+/g, "") : "345 * 25";
      const toolCall: ToolCall = {
        id: `call_calc_${Date.now()}`,
        name: "calculator",
        arguments: { expression },
      };

      result = {
        thought: `The user is asking a mathematical calculation. I will use the calculator tool to evaluate '${expression}'.`,
        toolCalls: [toolCall],
        finishReason: "tool_calls",
      };
      this.emitStream(result, request);
      return result;
    }

    // Check if the user asks for time
    if (
      userText.includes("time") ||
      userText.includes("date") ||
      userText.includes("day")
    ) {
      const toolCall: ToolCall = {
        id: `call_time_${Date.now()}`,
        name: "get_current_time",
        arguments: {},
      };

      result = {
        thought:
          "The user requested the current time. I will invoke get_current_time.",
        toolCalls: [toolCall],
        finishReason: "tool_calls",
      };
      this.emitStream(result, request);
      return result;
    }

    // Default conversational response
    result = {
      thought: `Received user prompt: "${lastMessage?.content}". Formulating autonomous reasoning plan.`,
      content: `Hello! I am Crucible running in local mock mode. You asked: "${lastMessage?.content}". How can I help you further?`,
      finishReason: "stop",
    };
    this.emitStream(result, request);
    return result;
  }
}
