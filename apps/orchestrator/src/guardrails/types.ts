import type { ToolCall, StepRecord } from "../schema/envelope";
import type { RegisteredTool, ToolDefinition } from "../tools/types";

export type GuardrailAction = "allow" | "block" | "require_approval" | "modify";

export interface SessionGuardrailStats {
  toolCallCount: number;
  blockedCount: number;
  approvedCount: number;
  rejectedCount: number;
  recentCalls: Array<{ toolName: string; argsHash: string; timestamp: number }>;
}

export interface GuardrailEvaluationContext {
  sessionId: string;
  turnId: number;
  toolCall: ToolCall;
  toolDefinition?: RegisteredTool | ToolDefinition;
  sessionHistory?: StepRecord[];
  sessionStats?: SessionGuardrailStats;
  metadata?: Record<string, unknown>;
}

export interface GuardrailEvaluationResult {
  action: GuardrailAction;
  policyName: string;
  reason?: string;
  modifiedArguments?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface GuardrailPolicy {
  readonly name: string;
  readonly description: string;
  evaluate(
    context: GuardrailEvaluationContext,
  ): Promise<GuardrailEvaluationResult> | GuardrailEvaluationResult;
}
