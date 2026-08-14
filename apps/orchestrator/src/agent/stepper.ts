import type { ToolResult } from "../schema/envelope";
import type { ModelProvider } from "../provider/provider.interface";
import type { ToolRegistry } from "../tools/registry";
import type { AgentStateMachine } from "./state-machine";

export async function stepAwaitingModel(
  stateMachine: AgentStateMachine,
  provider: ModelProvider,
  tools: ToolRegistry,
  options: { model?: string; temperature?: number } = {},
): Promise<void> {
  const ctx = stateMachine.getContext();

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
      requiresHuman = response.toolCalls.some((tc) =>
        tools.requiresApproval(tc),
      );
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
  }
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
    const envelope = await tools.execute(call, {
      sessionId: ctx.sessionId,
      step: ctx.stepCount,
      onStdout: (chunk) =>
        options.onToolStdout?.({ toolCallId: call.id, chunk }),
      onStderr: (chunk) =>
        options.onToolStderr?.({ toolCallId: call.id, chunk }),
    });

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
  }

  stateMachine.send({
    type: "TOOL_RESULTS",
    results,
  });
}
