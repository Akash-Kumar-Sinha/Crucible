import type { AgentMessage, ToolCall } from "../schema/envelope";
import type { ToolDefinition } from "../schema/tool";

/**
 * Common Parameters for Model Invocations
 */
export interface ModelRequest {
  messages: AgentMessage[];
  tools?: ToolDefinition[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  onToken?: (token: string) => void;
  onThought?: (thought: string) => void;
}

/**
 * Standardized Model Response across all providers
 */
export interface ModelResponse {
  thought?: string;
  content?: string;
  toolCalls?: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "error";
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  raw?: unknown;
}

/**
 * Provider Strategy Pattern Interface
 *
 * Any unified LLM provider or gateway implements this interface
 * to be swappable without altering the agent loop.
 */
export interface ModelProvider {
  /** Unique provider identifier */
  readonly name: string;

  /** Default model identifier */
  readonly defaultModel: string;

  /**
   * Dispatches a chat completion request with optional tool calling.
   */
  complete(request: ModelRequest): Promise<ModelResponse>;
}
