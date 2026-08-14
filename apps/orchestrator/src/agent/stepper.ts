import type { ToolResult } from "../schema/envelope";
import type { ModelProvider } from "../provider/provider.interface";
import type { ToolRegistry } from "../tools/registry";
import type { AgentStateMachine } from "./state-machine";
import { tracer } from "../observability/otel";

export async function stepAwaitingModel(
  stateMachine: AgentStateMachine,
  provider: ModelProvider,
  tools: ToolRegistry,
  options: { model?: string; temperature?: number } = {},
): Promise<void> {
  const ctx = stateMachine.getContext();

  await tracer
    .withSpan(
      "agent.model_completion",
      {
        sessionId: ctx.sessionId,
        turnId: ctx.stepCount,
        model: options.model,
        provider: provider.name,
        messagesCount: ctx.messages.length,
      },
      async (span) => {
        try {
          const response = await provider.complete({
            messages: ctx.messages,
            tools: tools.getDefinitions(),
            model: options.model,
            temperature: options.temperature,
            systemPrompt: ctx.systemPrompt,
          });

          let requiresHuman = false;
          if (response.toolCalls && response.toolCalls.length > 0) {
            span.setAttribute("toolCallsCount", response.toolCalls.length);
            requiresHuman = response.toolCalls.some((tc) =>
              tools.requiresApproval(tc),
            );
          }

          if (response.usage) {
            span.setAttribute("promptTokens", response.usage.promptTokens);
            span.setAttribute(
              "completionTokens",
              response.usage.completionTokens,
            );
            span.setAttribute("totalTokens", response.usage.totalTokens);
          }

          stateMachine.send({
            type: "MODEL_RESPONSE",
            response,
            hasHumanApprovalRequired: requiresHuman,
          });
        } catch (err: any) {
          stateMachine.send({
            type: "ERROR",
            message: `Model invocation error (${provider.name}): ${err?.message || err}`,
            details: err,
          });
          throw err;
        }
      },
    )
    .catch(() => {
      // Errors handled through state machine
    });
}

export async function stepAwaitingTool(
  stateMachine: AgentStateMachine,
  tools: ToolRegistry,
  options: {
    onToolStdout?: (data: { toolCallId: string; chunk: string }) => void;
    onToolStderr?: (data: { toolCallId: string; chunk: string }) => void;
  } = {},
): Promise<void> {
  const ctx = stateMachine.getContext();
  const pendingCalls = ctx.pendingToolCalls;

  const results: ToolResult[] = [];
  for (const call of pendingCalls) {
    await tracer.withSpan(
      `tool.${call.name}`,
      {
        sessionId: ctx.sessionId,
        turnId: ctx.stepCount,
        toolCallId: call.id,
        toolName: call.name,
      },
      async (span) => {
        const envelope = await tools.execute(call, {
          sessionId: ctx.sessionId,
          step: ctx.stepCount,
          onStdout: (chunk) =>
            options.onToolStdout?.({ toolCallId: call.id, chunk }),
          onStderr: (chunk) =>
            options.onToolStderr?.({ toolCallId: call.id, chunk }),
        });

        span.setAttribute("status", envelope.status);
        span.setAttribute("durationMs", envelope.durationMs);
        if (envelope.error) {
          span.setAttribute("error", envelope.error.message);
        }

        results.push({
          toolCallId: envelope.callId,
          name: envelope.toolName,
          status: envelope.status,
          output: envelope.output,
          error: envelope.error?.message,
          metadata: {
            durationMs: envelope.durationMs,
            timestamp: envelope.timestamp,
          },
        });
      },
    );
  }

  stateMachine.send({
    type: "TOOL_RESULTS",
    results,
  });
}
