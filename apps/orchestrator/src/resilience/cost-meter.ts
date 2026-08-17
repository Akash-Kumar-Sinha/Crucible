import { logger } from "../observability/logger";

export interface ModelPricing {
  promptCostPer1kTokens: number;
  completionCostPer1kTokens: number;
  cachedPromptCostPer1kTokens?: number;
}

export interface TokenUsageRecord {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  totalTokens: number;
}

export interface CostRecord {
  sessionId: string;
  turnIndex: number;
  model: string;
  tokens: TokenUsageRecord;
  promptCostUsd: number;
  completionCostUsd: number;
  totalCostUsd: number;
  timestamp: string;
}

export interface CostLimitConfig {
  maxCostPerRunUsd?: number;
  maxCostPerSessionUsd?: number;
  maxTokensPerRun?: number;
  maxTokensPerSession?: number;
}

export class CostLimitExceededError extends Error {
  readonly sessionId: string;
  readonly currentCostUsd: number;
  readonly limitCostUsd: number;

  constructor(
    sessionId: string,
    currentCostUsd: number,
    limitCostUsd: number,
    type: "run" | "session",
  ) {
    super(
      `Cost cap exceeded for session '${sessionId}' (${type} cost $${currentCostUsd.toFixed(4)} >= cap $${limitCostUsd.toFixed(4)})`,
    );
    this.name = "CostLimitExceededError";
    this.sessionId = sessionId;
    this.currentCostUsd = currentCostUsd;
    this.limitCostUsd = limitCostUsd;
  }
}

export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  "openrouter/free": { promptCostPer1kTokens: 0, completionCostPer1kTokens: 0 },
  mock: { promptCostPer1kTokens: 0, completionCostPer1kTokens: 0 },
  "anthropic/claude-3.5-sonnet": {
    promptCostPer1kTokens: 0.003,
    completionCostPer1kTokens: 0.015,
  },
  "anthropic/claude-3.7-sonnet": {
    promptCostPer1kTokens: 0.003,
    completionCostPer1kTokens: 0.015,
  },
  "openai/gpt-4o": {
    promptCostPer1kTokens: 0.0025,
    completionCostPer1kTokens: 0.01,
  },
  "openai/gpt-4o-mini": {
    promptCostPer1kTokens: 0.00015,
    completionCostPer1kTokens: 0.0006,
  },
  "google/gemini-2.0-flash": {
    promptCostPer1kTokens: 0.0001,
    completionCostPer1kTokens: 0.0004,
  },
  "meta-llama/llama-3.3-70b-instruct": {
    promptCostPer1kTokens: 0.0004,
    completionCostPer1kTokens: 0.0004,
  },
  "deepseek/deepseek-r1": {
    promptCostPer1kTokens: 0.00055,
    completionCostPer1kTokens: 0.00219,
  },
  default: { promptCostPer1kTokens: 0.001, completionCostPer1kTokens: 0.003 },
};

export class CostMeter {
  private readonly sessionCosts = new Map<string, CostRecord[]>();
  private readonly limits: CostLimitConfig;

  constructor(limits: CostLimitConfig = {}) {
    this.limits = {
      maxCostPerRunUsd: limits.maxCostPerRunUsd ?? 2.0,
      maxCostPerSessionUsd: limits.maxCostPerSessionUsd ?? 20.0,
      maxTokensPerRun: limits.maxTokensPerRun ?? 128_000,
      maxTokensPerSession: limits.maxTokensPerSession ?? 1_000_000,
    };
  }

  calculateCost(
    model: string,
    usage: TokenUsageRecord,
  ): { promptCost: number; completionCost: number; totalCost: number } {
    const pricing =
      DEFAULT_MODEL_PRICING[model] || DEFAULT_MODEL_PRICING["default"];
    const promptTokens = usage.promptTokens || 0;
    const completionTokens = usage.completionTokens || 0;
    const cachedTokens = usage.cachedTokens || 0;
    const nonCachedPromptTokens = Math.max(0, promptTokens - cachedTokens);

    const cachedRate =
      pricing.cachedPromptCostPer1kTokens ??
      pricing.promptCostPer1kTokens * 0.5;
    const promptCost =
      (nonCachedPromptTokens / 1000) * pricing.promptCostPer1kTokens +
      (cachedTokens / 1000) * cachedRate;
    const completionCost =
      (completionTokens / 1000) * pricing.completionCostPer1kTokens;
    const totalCost = promptCost + completionCost;

    return {
      promptCost: Number(promptCost.toFixed(6)),
      completionCost: Number(completionCost.toFixed(6)),
      totalCost: Number(totalCost.toFixed(6)),
    };
  }

  recordUsage(
    sessionId: string,
    model: string,
    usage: TokenUsageRecord,
    turnIndex = 0,
  ): CostRecord {
    const { promptCost, completionCost, totalCost } = this.calculateCost(
      model,
      usage,
    );

    const record: CostRecord = {
      sessionId,
      turnIndex,
      model,
      tokens: { ...usage },
      promptCostUsd: Number(promptCost.toFixed(6)),
      completionCostUsd: Number(completionCost.toFixed(6)),
      totalCostUsd: Number(totalCost.toFixed(6)),
      timestamp: new Date().toISOString(),
    };

    let records = this.sessionCosts.get(sessionId);
    if (!records) {
      records = [];
      this.sessionCosts.set(sessionId, records);
    }
    records.push(record);

    // Verify run cost limit
    if (
      this.limits.maxCostPerRunUsd &&
      totalCost > this.limits.maxCostPerRunUsd
    ) {
      logger.error(
        { sessionId, totalCost, limit: this.limits.maxCostPerRunUsd },
        "[CostMeter] Per-run cost limit exceeded",
      );
      throw new CostLimitExceededError(
        sessionId,
        totalCost,
        this.limits.maxCostPerRunUsd,
        "run",
      );
    }

    // Verify session aggregate limit
    const totalSessionCost = records.reduce(
      (acc, r) => acc + r.totalCostUsd,
      0,
    );
    if (
      this.limits.maxCostPerSessionUsd &&
      totalSessionCost > this.limits.maxCostPerSessionUsd
    ) {
      logger.error(
        {
          sessionId,
          totalSessionCost,
          limit: this.limits.maxCostPerSessionUsd,
        },
        "[CostMeter] Total session cost limit exceeded",
      );
      throw new CostLimitExceededError(
        sessionId,
        totalSessionCost,
        this.limits.maxCostPerSessionUsd,
        "session",
      );
    }

    return record;
  }

  getSessionCost(sessionId: string): {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    records: CostRecord[];
  } {
    const records = this.sessionCosts.get(sessionId) || [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;
    let totalCostUsd = 0;

    for (const r of records) {
      totalPromptTokens += r.tokens.promptTokens || 0;
      totalCompletionTokens += r.tokens.completionTokens || 0;
      totalTokens += r.tokens.totalTokens || 0;
      totalCostUsd += r.totalCostUsd;
    }

    return {
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      records: [...records],
    };
  }

  getAllCostsSummary(): {
    totalCostUsd: number;
    totalTokens: number;
    activeSessions: number;
  } {
    let totalCostUsd = 0;
    let totalTokens = 0;

    for (const records of this.sessionCosts.values()) {
      for (const r of records) {
        totalCostUsd += r.totalCostUsd;
        totalTokens += r.tokens.totalTokens || 0;
      }
    }

    return {
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      totalTokens,
      activeSessions: this.sessionCosts.size,
    };
  }
}

let globalCostMeter: CostMeter | null = null;

export function getCostMeter(): CostMeter {
  if (!globalCostMeter) {
    globalCostMeter = new CostMeter();
  }
  return globalCostMeter;
}
