import type { AgentMessage, ToolCall } from "../schema/envelope";
import { toJsonSchema } from "../tools/schema";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "./provider.interface";
import {
  cleanThoughtTags,
  extractThought,
  StreamingThoughtExtractor,
} from "./thought-parser";

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function resolveApiKey(explicitKey?: string): string {
  if (explicitKey) return explicitKey;
  if (process.env.OPENROUTER_API_KEY)
    return process.env.OPENROUTER_API_KEY.trim();
  if (process.env.OPENROUTER) return process.env.OPENROUTER.trim();

  // Search candidate .env paths up the tree
  const candidatePaths = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../.env"),
    resolve(process.cwd(), "../../.env"),
    "/home/aks/vs_stuff/Development/devs_in_ai/Crucible/.env",
  ];

  for (const envPath of candidatePaths) {
    if (existsSync(envPath)) {
      try {
        const text = readFileSync(envPath, "utf-8");
        const match = text.match(
          /OPENROUTER(?:_API_KEY)?=["']?([^"'\r\n]+)["']?/,
        );
        if (match && match[1]) {
          const key = match[1].trim();
          process.env.OPENROUTER_API_KEY = key;
          return key;
        }
      } catch {
        // continue search
      }
    }
  }

  return "";
}

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
    this.apiKey = resolveApiKey(config.apiKey);
    this.baseUrl = config.baseUrl || "https://openrouter.ai/api/v1";
    this.defaultModel =
      config.defaultModel || process.env.OPENROUTER_MODEL || "openrouter/free";
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
    const shouldStream = Boolean(request.onToken || request.onThought);
    if (shouldStream) {
      payload.stream = true;
    }

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
      let userFriendlyMessage = `OpenRouter API error (${response.status} ${response.statusText})`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson?.error?.message) {
          if (
            response.status === 429 ||
            errorJson.error.message.includes("Rate limit exceeded") ||
            errorJson.error.message.includes("free-models-per-day")
          ) {
            userFriendlyMessage = `OpenRouter Free Tier Limit Reached (50 requests/day): ${errorJson.error.message}. Please update OPENROUTER_API_KEY in .env with a new key or set OPENROUTER_MODEL="mock" for offline local testing.`;
          } else {
            userFriendlyMessage = `OpenRouter Error (${response.status}): ${errorJson.error.message}`;
          }
        }
      } catch {
        userFriendlyMessage = `${userFriendlyMessage}: ${errorText}`;
      }
      throw new Error(userFriendlyMessage);
    }

    if (shouldStream && response.body) {
      return this.handleSseStream(response.body, request);
    }

    const data = (await response.json()) as any;
    if (data.error) {
      const msg = data.error.message || JSON.stringify(data.error);
      throw new Error(`OpenRouter error: ${msg}`);
    }

    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error(
        `OpenRouter returned empty choices: ${JSON.stringify(data)}`,
      );
    }

    return this.parseChoice(choice, data);
  }

  private async handleSseStream(
    body: ReadableStream<Uint8Array>,
    request: ModelRequest,
  ): Promise<ModelResponse> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    let rawContent = "";
    let streamedThought = "";
    let finishReason: string | undefined;
    let usage: any = undefined;
    const toolCallsMap = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    const thoughtExtractor = new StreamingThoughtExtractor({
      onToken: (chunk) => {
        request.onToken?.(chunk);
      },
      onThought: (chunk) => {
        streamedThought += chunk;
        request.onThought?.(chunk);
      },
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (
          !trimmed ||
          trimmed.startsWith(":") ||
          !trimmed.startsWith("data:")
        ) {
          continue;
        }

        const dataStr = trimmed.replace(/^data:\s*/, "");
        if (dataStr === "[DONE]") {
          break;
        }

        try {
          const json = JSON.parse(dataStr);
          if (json.usage) usage = json.usage;

          const choice = json.choices?.[0];
          if (!choice) continue;

          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }

          const delta = choice.delta || {};

          const reasoningChunk =
            delta.reasoning || delta.reasoning_content || delta.thinking || "";
          if (reasoningChunk) {
            streamedThought += reasoningChunk;
            request.onThought?.(reasoningChunk);
          }

          if (delta.content) {
            rawContent += delta.content;
            thoughtExtractor.feed(delta.content);
          }

          if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallsMap.has(idx)) {
                toolCallsMap.set(idx, {
                  id: tc.id || "",
                  name: tc.function?.name || "",
                  arguments: tc.function?.arguments || "",
                });
              } else {
                const current = toolCallsMap.get(idx)!;
                if (tc.id) current.id += tc.id;
                if (tc.function?.name) current.name += tc.function.name;
                if (tc.function?.arguments)
                  current.arguments += tc.function.arguments;
              }
            }
          }
        } catch {
          // ignore malformed SSE line
        }
      }
    }

    thoughtExtractor.flush();

    const toolCalls: ToolCall[] = [];
    for (const item of toolCallsMap.values()) {
      let args: Record<string, unknown>;
      try {
        args = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        args = { raw: item.arguments };
      }
      toolCalls.push({
        id:
          item.id ||
          `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name: item.name,
        arguments: args,
      });
    }

    const finalThought =
      streamedThought.trim() || extractThought(rawContent) || undefined;
    const finalContent = cleanThoughtTags(rawContent) || undefined;

    return {
      thought: finalThought,
      content: finalContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: this.mapFinishReason(finishReason, toolCalls.length > 0),
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
          }
        : undefined,
      raw: { streamed: true, rawContent },
    };
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

    const reasoningField =
      message.reasoning || message.reasoning_content || message.thinking || "";
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
      let args: Record<string, unknown>;

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
          name: msg.name,
          content:
            typeof msg.content === "string"
              ? msg.content
              : JSON.stringify(msg.content),
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
