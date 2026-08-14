import { EventEmitter } from "node:events";
import type {
  GuardrailEvaluationContext,
  GuardrailEvaluationResult,
  GuardrailPolicy,
} from "./types";
import { logger } from "../observability/logger";
import {
  captureAgentError,
  getErrorReporter,
} from "../observability/error-reporter";
import { IrreversibleActionPolicy } from "./policies/irreversible-action";
import { ResourceBudgetPolicy } from "./policies/resource-budget";

export interface GuardrailChainOptions {
  policies?: GuardrailPolicy[];
  repeatedBlockThreshold?: number;
  failClosedOnPolicyError?: boolean;
}

export interface BlockEventRecord {
  sessionId: string;
  turnId: number;
  toolName: string;
  policyName: string;
  reason?: string;
  timestamp: number;
}

export class GuardrailChain extends EventEmitter {
  private policies: GuardrailPolicy[] = [];
  private repeatedBlockThreshold: number;
  private failClosedOnPolicyError: boolean;

  private sessionBlocks = new Map<string, BlockEventRecord[]>();

  constructor(options: GuardrailChainOptions = {}) {
    super();
    this.repeatedBlockThreshold = options.repeatedBlockThreshold ?? 3;
    this.failClosedOnPolicyError = options.failClosedOnPolicyError ?? true;

    if (options.policies && options.policies.length > 0) {
      this.policies = [...options.policies];
    } else {
      this.policies = [
        new IrreversibleActionPolicy(),
        new ResourceBudgetPolicy(),
      ];
    }
  }

  addPolicy(policy: GuardrailPolicy): this {
    this.policies.push(policy);
    return this;
  }

  removePolicy(name: string): this {
    this.policies = this.policies.filter((p) => p.name !== name);
    return this;
  }

  getPolicies(): GuardrailPolicy[] {
    return [...this.policies];
  }

  async evaluate(
    context: GuardrailEvaluationContext,
  ): Promise<GuardrailEvaluationResult> {
    let approvalRequiredResult: GuardrailEvaluationResult | null = null;

    for (const policy of this.policies) {
      try {
        const result = await policy.evaluate(context);

        if (result.action === "block") {
          this.recordBlock(context, result);
          return result;
        }

        if (result.action === "require_approval" && !approvalRequiredResult) {
          approvalRequiredResult = result;
        }

        if (result.action === "modify" && result.modifiedArguments) {
          context.toolCall.arguments = result.modifiedArguments;
        }
      } catch (err: any) {
        logger.error(
          {
            err,
            policyName: policy.name,
            sessionId: context.sessionId,
            turnId: context.turnId,
            tool: context.toolCall.name,
            alert: "CRUCIBLE_GUARDRAIL_CHAIN_FAILURE_ALERT",
          },
          `[Guardrail Failure] Policy '${policy.name}' threw an unexpected exception`,
        );

        captureAgentError(err, {
          sessionId: context.sessionId,
          turnId: context.turnId,
          toolName: context.toolCall.name,
          component: `guardrail.${policy.name}`,
          alert: "CRUCIBLE_GUARDRAIL_CHAIN_FAILURE_ALERT",
          extra: { policy: policy.name },
        });

        this.emit("policyError", {
          policy: policy.name,
          error: err,
          context,
        });

        if (this.failClosedOnPolicyError) {
          const failResult: GuardrailEvaluationResult = {
            action: "block",
            policyName: policy.name,
            reason: `Guardrail policy check failed due to an internal error: ${err?.message || err}`,
          };
          this.recordBlock(context, failResult);
          return failResult;
        }
      }
    }

    if (approvalRequiredResult) {
      return approvalRequiredResult;
    }

    return {
      action: "allow",
      policyName: "chain",
    };
  }

  private recordBlock(
    context: GuardrailEvaluationContext,
    result: GuardrailEvaluationResult,
  ): void {
    const { sessionId, turnId, toolCall } = context;
    const history = this.sessionBlocks.get(sessionId) || [];

    const record: BlockEventRecord = {
      sessionId,
      turnId,
      toolName: toolCall.name,
      policyName: result.policyName,
      reason: result.reason,
      timestamp: Date.now(),
    };

    history.push(record);
    this.sessionBlocks.set(sessionId, history);

    this.emit("toolBlocked", record);

    getErrorReporter().addBreadcrumb({
      category: "guardrail.block",
      message: `Tool '${toolCall.name}' blocked by policy '${result.policyName}' on session ${sessionId}`,
      data: {
        sessionId,
        turnId,
        toolName: toolCall.name,
        reason: result.reason,
      },
    });

    if (history.length >= this.repeatedBlockThreshold) {
      logger.warn(
        {
          sessionId,
          totalBlocks: history.length,
          recentBlocks: history.slice(-5),
          alert: "CRUCIBLE_REPEATED_GUARDRAIL_BLOCKS_ALERT",
        },
        `[Guardrail Alert] Session ${sessionId} exceeded repeated guardrail block threshold (${history.length} blocks)`,
      );

      captureAgentError(
        new Error(
          `Session '${sessionId}' exceeded repeated guardrail block threshold with ${history.length} blocked attempts.`,
        ),
        {
          sessionId,
          turnId,
          component: "guardrails.chain",
          alert: "CRUCIBLE_REPEATED_GUARDRAIL_BLOCKS_ALERT",
          extra: {
            blockCount: history.length,
            recentBlocks: history.slice(-5),
          },
        },
      );

      this.emit("repeatedBlocksThresholdExceeded", {
        sessionId,
        blockCount: history.length,
        history,
      });
    }
  }

  getBlockHistory(sessionId: string): BlockEventRecord[] {
    return [...(this.sessionBlocks.get(sessionId) || [])];
  }

  resetSession(sessionId: string): void {
    this.sessionBlocks.delete(sessionId);
    for (const policy of this.policies) {
      if (
        "resetSession" in policy &&
        typeof (policy as any).resetSession === "function"
      ) {
        (policy as any).resetSession(sessionId);
      }
    }
  }
}

let defaultChain: GuardrailChain | null = null;

export function getDefaultGuardrailChain(): GuardrailChain {
  if (!defaultChain) {
    defaultChain = new GuardrailChain();
  }
  return defaultChain;
}
