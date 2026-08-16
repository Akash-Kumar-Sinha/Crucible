import type { AgentMessage } from "../schema/envelope";
import type { ToolDefinition } from "../schema/tool";
import type { ModelProvider } from "../provider/provider.interface";
import {
  countContextTokens,
  countMessageTokens,
  countTextTokens,
  getModelContextProfile,
  type ModelContextProfile,
} from "./token-counter";
import { ContextSummarizer, type ConversationMemento } from "./summarizer";
import { logger } from "../observability/logger";
import { captureContextCompactionAlert } from "../observability/error-reporter";
import { EventEmitter } from "node:events";

export type StrategyType = "sliding_window" | "summarization" | "hybrid";

export interface ContextWindowMetadata {
  totalTokens: number;
  limit: number;
  usagePercent: number;
  isSummarized: boolean;
  summarizedTurnCount: number;
  runningSummary?: string;
  strategyName: StrategyType;
}

export interface PreparedContext {
  messages: AgentMessage[];
  metadata: ContextWindowMetadata;
}

export interface ContextPreparationConfig {
  model?: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  strategy?: StrategyType;
  sessionId?: string;
  tenantId?: string;
  maxRecentMessages?: number;
}

export interface ContextManagerOptions {
  provider?: ModelProvider;
  defaultStrategy?: StrategyType;
  compactionAlertThreshold?: number; // e.g. 3 compactions in rolling window
  compactionAlertWindowMs?: number; // e.g. 300_000 (5 min)
}

export interface ContextStrategy {
  readonly name: StrategyType;
  process(
    messages: AgentMessage[],
    profile: ModelContextProfile,
    summarizer: ContextSummarizer,
    config: ContextPreparationConfig,
    existingMemento?: ConversationMemento | null,
  ): Promise<{
    messages: AgentMessage[];
    memento?: ConversationMemento | null;
    isSummarized: boolean;
  }>;
}

export class SlidingWindowStrategy implements ContextStrategy {
  readonly name: StrategyType = "sliding_window";

  async process(
    messages: AgentMessage[],
    profile: ModelContextProfile,
    _summarizer: ContextSummarizer,
    config: ContextPreparationConfig,
  ): Promise<{
    messages: AgentMessage[];
    memento?: ConversationMemento | null;
    isSummarized: boolean;
  }> {
    const budget = Math.floor(
      profile.contextWindow * profile.safeThresholdPercent,
    );
    const systemTokens = config.systemPrompt
      ? countTextTokens(config.systemPrompt) + 4
      : 0;
    const availableBudget = budget - systemTokens - 50;

    if (messages.length <= 2) {
      return { messages, isSummarized: false };
    }

    // Always preserve initial user message if possible
    const initialUserMsg = messages.find((m) => m.role === "user");
    const initialUserTokens = initialUserMsg
      ? countMessageTokens(initialUserMsg)
      : 0;

    const remainingBudget = availableBudget - initialUserTokens;
    const keptRecent: AgentMessage[] = [];
    let currentTokens = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg === initialUserMsg && keptRecent.includes(msg)) continue;

      const msgTokens = countMessageTokens(msg);
      if (currentTokens + msgTokens > remainingBudget) {
        break;
      }
      keptRecent.unshift(msg);
      currentTokens += msgTokens;
    }

    const result: AgentMessage[] = [];
    if (initialUserMsg && !keptRecent.includes(initialUserMsg)) {
      result.push(initialUserMsg);
    }
    result.push(...keptRecent);

    const isSummarized = result.length < messages.length;
    return { messages: result, isSummarized };
  }
}

export class SummarizationStrategy implements ContextStrategy {
  readonly name: StrategyType = "summarization";

  async process(
    messages: AgentMessage[],
    _profile: ModelContextProfile,
    summarizer: ContextSummarizer,
    _config: ContextPreparationConfig,
    existingMemento?: ConversationMemento | null,
  ): Promise<{
    messages: AgentMessage[];
    memento?: ConversationMemento | null;
    isSummarized: boolean;
  }> {
    if (messages.length <= 3) {
      return { messages, memento: existingMemento, isSummarized: false };
    }

    // Retain only the very last active turn (user + assistant + tools) and summarize the rest
    const olderMessages = messages.slice(0, messages.length - 2);
    const recentMessages = messages.slice(messages.length - 2);

    const memento = await summarizer.summarizeTurns(
      olderMessages,
      existingMemento,
      Math.max(1, Math.floor(olderMessages.length / 2)),
    );

    const summarizedMessage: AgentMessage = {
      role: "system",
      content: memento.summary,
    };

    return {
      messages: [summarizedMessage, ...recentMessages],
      memento,
      isSummarized: true,
    };
  }
}

export class HybridStrategy implements ContextStrategy {
  readonly name: StrategyType = "hybrid";

  async process(
    messages: AgentMessage[],
    profile: ModelContextProfile,
    summarizer: ContextSummarizer,
    config: ContextPreparationConfig,
    existingMemento?: ConversationMemento | null,
  ): Promise<{
    messages: AgentMessage[];
    memento?: ConversationMemento | null;
    isSummarized: boolean;
  }> {
    const budget = Math.floor(
      profile.contextWindow * profile.safeThresholdPercent,
    );
    const currentTotalTokens = countContextTokens(
      messages,
      config.systemPrompt,
      config.tools,
      profile.model,
    );

    // If well within budget, return unmodified
    if (currentTotalTokens <= budget && messages.length <= 10) {
      return { messages, memento: existingMemento, isSummarized: false };
    }

    // Keep the most recent 4-6 messages intact
    const recentCount = Math.min(
      config.maxRecentMessages || 6,
      Math.max(2, Math.floor(messages.length / 2)),
    );
    const olderMessages = messages.slice(0, messages.length - recentCount);
    const recentMessages = messages.slice(messages.length - recentCount);

    if (olderMessages.length === 0) {
      return { messages, memento: existingMemento, isSummarized: false };
    }

    const memento = await summarizer.summarizeTurns(
      olderMessages,
      existingMemento,
      Math.max(1, Math.floor(olderMessages.length / 2)),
    );

    const summaryMessage: AgentMessage = {
      role: "system",
      content: memento.summary,
    };

    // Construct hybrid payload: [summary of past turns, ...recentMessages]
    const hybridMessages: AgentMessage[] = [summaryMessage, ...recentMessages];

    return {
      messages: hybridMessages,
      memento,
      isSummarized: true,
    };
  }
}

export class ContextWindowManager extends EventEmitter {
  private strategies: Map<StrategyType, ContextStrategy> = new Map();
  private defaultStrategy: StrategyType;
  private summarizer: ContextSummarizer;
  private compactionHistory: Map<string, number[]> = new Map(); // sessionId -> timestamps
  private sessionMementos: Map<string, ConversationMemento> = new Map();
  private compactionAlertThreshold: number;
  private compactionAlertWindowMs: number;

  constructor(options: ContextManagerOptions = {}) {
    super();
    this.defaultStrategy = options.defaultStrategy || "hybrid";
    this.summarizer = new ContextSummarizer({ provider: options.provider });
    this.compactionAlertThreshold = options.compactionAlertThreshold || 3;
    this.compactionAlertWindowMs = options.compactionAlertWindowMs || 300_000; // 5 min

    this.registerStrategy(new SlidingWindowStrategy());
    this.registerStrategy(new SummarizationStrategy());
    this.registerStrategy(new HybridStrategy());
  }

  registerStrategy(strategy: ContextStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }

  getMemento(sessionId: string): ConversationMemento | undefined {
    return this.sessionMementos.get(sessionId);
  }

  setMemento(sessionId: string, memento: ConversationMemento): void {
    this.sessionMementos.set(sessionId, memento);
  }

  async prepareMessages(
    messages: AgentMessage[],
    config: ContextPreparationConfig = {},
  ): Promise<PreparedContext> {
    const model = config.model;
    const profile = getModelContextProfile(model);
    const strategyName = config.strategy || this.defaultStrategy;
    const strategy =
      this.strategies.get(strategyName) ||
      this.strategies.get("hybrid") ||
      new HybridStrategy();

    const sessionId = config.sessionId || "default";
    const existingMemento = this.sessionMementos.get(sessionId);

    // Evaluate message tokens before compaction
    const rawTokens = countContextTokens(
      messages,
      config.systemPrompt,
      config.tools,
      model,
    );
    const safeLimit = Math.floor(
      profile.contextWindow * profile.safeThresholdPercent,
    );

    let processedMessages = messages;
    let isSummarized = Boolean(existingMemento);
    let activeMemento = existingMemento;

    // Apply strategy if tokens exceed safe limit or if memento exists
    if (rawTokens > safeLimit || messages.length > 8 || existingMemento) {
      const result = await strategy.process(
        messages,
        profile,
        this.summarizer,
        config,
        existingMemento,
      );

      processedMessages = result.messages;
      isSummarized = result.isSummarized;
      if (result.memento) {
        activeMemento = result.memento;
        this.sessionMementos.set(sessionId, result.memento);
        this.trackCompaction(
          sessionId,
          config.tenantId || "default",
          profile.model,
        );
      }
    }

    const finalTokens = countContextTokens(
      processedMessages,
      config.systemPrompt,
      config.tools,
      model,
    );
    const usagePercent = Math.min(
      100,
      Math.round((finalTokens / profile.contextWindow) * 100),
    );

    const metadata: ContextWindowMetadata = {
      totalTokens: finalTokens,
      limit: profile.contextWindow,
      usagePercent,
      isSummarized,
      summarizedTurnCount: activeMemento?.coveredTurns || 0,
      runningSummary: activeMemento?.summary,
      strategyName: strategy.name,
    };

    return {
      messages: processedMessages,
      metadata,
    };
  }

  private trackCompaction(
    sessionId: string,
    tenantId: string,
    modelName: string,
  ): void {
    const now = Date.now();
    const timestamps = this.compactionHistory.get(sessionId) || [];
    const windowStart = now - this.compactionAlertWindowMs;

    const recentTimestamps = timestamps.filter((t) => t >= windowStart);
    recentTimestamps.push(now);
    this.compactionHistory.set(sessionId, recentTimestamps);

    if (recentTimestamps.length >= this.compactionAlertThreshold) {
      const alertPayload = {
        alert: "RepeatedContextCompaction",
        sessionId,
        tenantId,
        model: modelName,
        compactionCount: recentTimestamps.length,
        windowMs: this.compactionAlertWindowMs,
        recommendation:
          "Consider routing to a higher-context model (e.g. 200k/1M tokens) or applying more aggressive summarization.",
      };

      logger.warn(
        alertPayload,
        "Repeated context compaction threshold reached for session",
      );
      captureContextCompactionAlert(alertPayload);
      this.emit("compaction_overflow_alert", alertPayload);
    }
  }
}
