import type { AgentMessage, ToolCall } from "../schema/envelope";
import { toJsonSchema } from "../tools/schema";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "./provider.interface";
import { cleanThoughtTags, extractThought } from "./thought-parser";

export interface OpenRouterConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  siteUrl?: string;
  siteName?: string;
}

export class OpenRouterProvider implements ModelProvider {
  readonly name = "openrouter";
  readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly siteUrl: string;
  private readonly siteName: string;

  constructor(config: OpenRouterConfig = {}) {
    this.apiKey =
      config.apiKey ||
      process.env.OPENROUTER ||
      process.env.OPENROUTER_API_KEY ||
      "";
    this.baseUrl = config.baseUrl || "https://openrouter.ai/api/v1";
    this.defaultModel =
      config.defaultModel || "nvidia/nemotron-3-nano-30b-a3b:free";
    this.siteUrl = config.siteUrl || "https://github.com/crucible/crucible";
    this.siteName = config.siteName || "Crucible Orchestrator";
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (!this.apiKey) {
      throw new Error(
        "OpenRouter API key is missing. Set OPENROUTER or OPENROUTER_API_KEY in your environment (.env).",
      );
    }

    const payload = this.buildPayload(request);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": this.siteUrl,
        "X-Title": this.siteName,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenRouter API error (${response.status} ${response.statusText}): ${errorText}`,
      );
    }

    const data = (await response.json()) as any;
    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error(
        "OpenRouter returned empty choices in completion response",
      );
    }

    return this.parseChoice(choice, data);
  }

  private buildPayload(request: ModelRequest): Record<string, unknown> {
    const model = request.model || this.defaultModel;
    const messages = this.formatMessages(
      request.messages,
      request.systemPrompt,
    );

    const payload: Record<string, unknown> = {
      model,
      messages,
      temperature: request.temperature ?? 0.2,
    };

    if (request.maxTokens) {
      payload.max_tokens = request.maxTokens;
    }

    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: toJsonSchema(t.parameters),
        },
      }));
    }

    return payload;
  }

  private parseChoice(choice: any, data: any): ModelResponse {
    const message = choice.message || {};
    const rawContent: string = message.content || "";

    const reasoningField = message.reasoning || message.thinking || "";
    const parsedThought = reasoningField || extractThought(rawContent);
    const cleanedContent = cleanThoughtTags(rawContent);

    const toolCalls = this.parseToolCalls(message.tool_calls);
    const finishReason = this.mapFinishReason(
      choice.finish_reason,
      toolCalls.length > 0,
    );

    return {
      thought: parsedThought || undefined,
      content: cleanedContent || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
      raw: data,
    };
  }

  private parseToolCalls(rawToolCalls: any[]): ToolCall[] {
    if (!Array.isArray(rawToolCalls)) return [];

    return rawToolCalls.map((tc) => {
      let args: Record<string, unknown> = {};
      try {
        args =
          typeof tc.function?.arguments === "string"
            ? JSON.parse(tc.function.arguments)
            : tc.function?.arguments || {};
      } catch {
        args = { raw: tc.function?.arguments };
      }

      return {
        id:
          tc.id ||
          `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name: tc.function?.name || "",
        arguments: args,
      };
    });
  }

  private formatMessages(
    messages: AgentMessage[],
    systemPrompt?: string,
  ): Array<Record<string, unknown>> {
    const formatted: Array<Record<string, unknown>> = [];

    if (systemPrompt) {
      formatted.push({
        role: "system",
        content: systemPrompt,
      });
    }

    for (const msg of messages) {
      if (msg.role === "tool") {
        formatted.push({
          role: "tool",
          tool_call_id: msg.toolCallId || "unknown",
          content: msg.content,
        });
      } else if (msg.role === "assistant") {
        const item: Record<string, unknown> = {
          role: "assistant",
          content: msg.content || null,
        };

        if (msg.toolCalls && msg.toolCalls.length > 0) {
          item.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }

        formatted.push(item);
      } else {
        formatted.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    return formatted;
  }

  private mapFinishReason(
    reason?: string,
    hasToolCalls = false,
  ): "stop" | "tool_calls" | "length" | "error" {
    if (reason === "tool_calls" || hasToolCalls) {
      return "tool_calls";
    }
    if (reason === "length") {
      return "length";
    }
    if (reason === "error") {
      return "error";
    }
    return "stop";
  }
}
