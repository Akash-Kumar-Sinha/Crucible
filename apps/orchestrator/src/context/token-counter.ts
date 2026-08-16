import type { AgentMessage } from "../schema/envelope";
import type { ToolDefinition } from "../schema/tool";

export interface ModelContextProfile {
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  safeThresholdPercent: number;
  tokensPerCharApprox: number;
}

const MODEL_PROFILES: Record<string, ModelContextProfile> = {
  "anthropic/claude-3.5-sonnet": {
    model: "anthropic/claude-3.5-sonnet",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    safeThresholdPercent: 0.8,
    tokensPerCharApprox: 0.28,
  },
  "anthropic/claude-3-opus": {
    model: "anthropic/claude-3-opus",
    contextWindow: 200000,
    maxOutputTokens: 4096,
    safeThresholdPercent: 0.8,
    tokensPerCharApprox: 0.28,
  },
  "anthropic/claude-3.5-haiku": {
    model: "anthropic/claude-3.5-haiku",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    safeThresholdPercent: 0.8,
    tokensPerCharApprox: 0.28,
  },
  "openai/gpt-4o": {
    model: "openai/gpt-4o",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    safeThresholdPercent: 0.75,
    tokensPerCharApprox: 0.27,
  },
  "openai/gpt-4o-mini": {
    model: "openai/gpt-4o-mini",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    safeThresholdPercent: 0.75,
    tokensPerCharApprox: 0.27,
  },
  "deepseek/deepseek-chat": {
    model: "deepseek/deepseek-chat",
    contextWindow: 64000,
    maxOutputTokens: 4096,
    safeThresholdPercent: 0.75,
    tokensPerCharApprox: 0.3,
  },
  "deepseek/deepseek-r1": {
    model: "deepseek/deepseek-r1",
    contextWindow: 64000,
    maxOutputTokens: 8192,
    safeThresholdPercent: 0.75,
    tokensPerCharApprox: 0.3,
  },
  "google/gemini-2.0-flash-001": {
    model: "google/gemini-2.0-flash-001",
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    safeThresholdPercent: 0.85,
    tokensPerCharApprox: 0.26,
  },
  "meta-llama/llama-3.3-70b-instruct": {
    model: "meta-llama/llama-3.3-70b-instruct",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    safeThresholdPercent: 0.75,
    tokensPerCharApprox: 0.28,
  },
  "openrouter/free": {
    model: "openrouter/free",
    contextWindow: 32768,
    maxOutputTokens: 4096,
    safeThresholdPercent: 0.7,
    tokensPerCharApprox: 0.28,
  },
};

const DEFAULT_PROFILE: ModelContextProfile = {
  model: "default",
  contextWindow: 65536,
  maxOutputTokens: 4096,
  safeThresholdPercent: 0.75,
  tokensPerCharApprox: 0.28,
};

export function getModelContextProfile(model?: string): ModelContextProfile {
  if (!model) return DEFAULT_PROFILE;

  const normalized = model.toLowerCase().trim();
  if (MODEL_PROFILES[normalized]) {
    return MODEL_PROFILES[normalized];
  }

  // Prefix matching for model families
  for (const [key, profile] of Object.entries(MODEL_PROFILES)) {
    if (normalized.startsWith(key) || key.startsWith(normalized)) {
      return profile;
    }
  }

  if (normalized.includes("claude-3") || normalized.includes("sonnet")) {
    return MODEL_PROFILES["anthropic/claude-3.5-sonnet"];
  }
  if (normalized.includes("gpt-4")) {
    return MODEL_PROFILES["openai/gpt-4o"];
  }
  if (normalized.includes("deepseek")) {
    return MODEL_PROFILES["deepseek/deepseek-chat"];
  }
  if (normalized.includes("gemini")) {
    return MODEL_PROFILES["google/gemini-2.0-flash-001"];
  }
  if (normalized.includes("llama-3")) {
    return MODEL_PROFILES["meta-llama/llama-3.3-70b-instruct"];
  }

  return DEFAULT_PROFILE;
}

export function countTextTokens(text: string): number {
  if (!text || text.length === 0) return 0;

  // Split on whitespace, punctuation, and code token boundaries
  const words = text.match(/\p{L}+|\p{N}+|[^\s\p{L}\p{N}]+/gu);
  if (!words) {
    return Math.ceil(text.length * 0.28);
  }

  let tokenCount = 0;
  for (const word of words) {
    if (word.length <= 4) {
      tokenCount += 1;
    } else {
      tokenCount += Math.ceil(word.length / 3.7);
    }
  }

  // Account for leading/trailing whitespaces and formatting overhead
  return Math.max(1, tokenCount);
}

export function countMessageTokens(
  message: AgentMessage,
  _model?: string,
): number {
  // Base message framing overhead (role, markers, delimiters)
  let count = 4;

  if (message.content) {
    count += countTextTokens(message.content);
  }

  if (message.thought) {
    count += countTextTokens(message.thought) + 4;
  }

  if (message.name) {
    count += countTextTokens(message.name) + 2;
  }

  if (message.toolCallId) {
    count += countTextTokens(message.toolCallId) + 2;
  }

  if (message.toolCalls && message.toolCalls.length > 0) {
    for (const call of message.toolCalls) {
      count += countTextTokens(call.name) + 6;
      if (call.arguments) {
        const serialized =
          typeof call.arguments === "string"
            ? call.arguments
            : JSON.stringify(call.arguments);
        count += countTextTokens(serialized);
      }
    }
  }

  return count;
}

export function countToolTokens(tool: ToolDefinition): number {
  let count =
    countTextTokens(tool.name) + countTextTokens(tool.description) + 8;

  if (tool.parameters) {
    const serialized = JSON.stringify(tool.parameters);
    count += countTextTokens(serialized);
  }

  return count;
}

export function countContextTokens(
  messages: AgentMessage[],
  systemPrompt?: string,
  tools?: ToolDefinition[],
  model?: string,
): number {
  let total = 3; // Prime conversation wrapper

  if (systemPrompt) {
    total += countTextTokens(systemPrompt) + 4;
  }

  if (tools && tools.length > 0) {
    for (const tool of tools) {
      total += countToolTokens(tool);
    }
  }

  for (const message of messages) {
    total += countMessageTokens(message, model);
  }

  return total;
}
