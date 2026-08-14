import type {
  GuardrailEvaluationContext,
  GuardrailEvaluationResult,
  GuardrailPolicy,
} from "../types";

export interface ResourceBudgetOptions {
  maxToolCallsPerSession?: number;
  maxCallsPerTurn?: number;
  maxConsecutiveIdenticalCalls?: number;
}

export class ResourceBudgetPolicy implements GuardrailPolicy {
  readonly name = "resource_budget";
  readonly description =
    "Enforces execution quotas, prevents runaway tool loops, and limits repetitive calls.";

  private maxToolCallsPerSession: number;
  private maxCallsPerTurn: number;
  private maxConsecutiveIdenticalCalls: number;

  private sessionUsage = new Map<
    string,
    {
      totalCalls: number;
      turnCalls: Map<number, number>;
      recentSignatures: string[];
    }
  >();

  constructor(options: ResourceBudgetOptions = {}) {
    this.maxToolCallsPerSession = options.maxToolCallsPerSession ?? 50;
    this.maxCallsPerTurn = options.maxCallsPerTurn ?? 10;
    this.maxConsecutiveIdenticalCalls =
      options.maxConsecutiveIdenticalCalls ?? 3;
  }

  evaluate(context: GuardrailEvaluationContext): GuardrailEvaluationResult {
    const { sessionId, turnId, toolCall } = context;

    let usage = this.sessionUsage.get(sessionId);
    if (!usage) {
      usage = {
        totalCalls: 0,
        turnCalls: new Map(),
        recentSignatures: [],
      };
      this.sessionUsage.set(sessionId, usage);
    }

    if (usage.totalCalls >= this.maxToolCallsPerSession) {
      return {
        action: "block",
        policyName: this.name,
        reason: `Session tool call limit reached (${usage.totalCalls}/${this.maxToolCallsPerSession} calls).`,
        metadata: {
          current: usage.totalCalls,
          limit: this.maxToolCallsPerSession,
        },
      };
    }

    const turnCount = usage.turnCalls.get(turnId) || 0;
    if (turnCount >= this.maxCallsPerTurn) {
      return {
        action: "block",
        policyName: this.name,
        reason: `Turn tool call limit exceeded (${turnCount}/${this.maxCallsPerTurn} calls in turn ${turnId}).`,
        metadata: { turnId, turnCount, limit: this.maxCallsPerTurn },
      };
    }

    const signature = `${toolCall.name}:${JSON.stringify(toolCall.arguments || {})}`;
    const recent = usage.recentSignatures;
    if (recent.length >= this.maxConsecutiveIdenticalCalls) {
      const allIdentical = recent
        .slice(-this.maxConsecutiveIdenticalCalls)
        .every((s) => s === signature);

      if (allIdentical) {
        return {
          action: "block",
          policyName: this.name,
          reason: `Detected infinite tool loop: '${toolCall.name}' was invoked with identical parameters ${this.maxConsecutiveIdenticalCalls} consecutive times.`,
          metadata: { toolName: toolCall.name, signature },
        };
      }
    }

    usage.totalCalls += 1;
    usage.turnCalls.set(turnId, turnCount + 1);
    usage.recentSignatures.push(signature);
    if (usage.recentSignatures.length > 10) {
      usage.recentSignatures.shift();
    }

    return {
      action: "allow",
      policyName: this.name,
    };
  }

  resetSession(sessionId: string): void {
    this.sessionUsage.delete(sessionId);
  }
}
