import type { ToolResult } from "../../schema/envelope";
import type { AgentContext, AgentEvent, AgentState } from "./types";

export function computeNextState(
  context: AgentContext,
  currentState: AgentState,
  event: AgentEvent,
): AgentState {
  if (event.type === "ERROR") {
    context.error = { message: event.message, details: event.details };
    return "error";
  }

  if (event.type === "ABORT") {
    context.error = { message: event.reason || "Execution aborted by user" };
    return "error";
  }

  if (event.type === "START") {
    context.messages.push({ role: "user", content: event.prompt });
    context.error = undefined;
    return "awaiting_model";
  }

  switch (currentState) {
    case "awaiting_model":
      return handleAwaitingModel(context, event);
    case "awaiting_tool":
      return handleAwaitingTool(context, event);
    case "awaiting_human":
      return handleAwaitingHuman(context, event);
    case "done":
    case "error":
      return currentState;
  }
}

function handleAwaitingModel(
  context: AgentContext,
  event: AgentEvent,
): AgentState {
  if (event.type === "START") {
    context.messages.push({ role: "user", content: event.prompt });
    return "awaiting_model";
  }

  if (event.type === "MODEL_RESPONSE") {
    context.stepCount += 1;
    const res = event.response;
    context.currentThought = res.thought;

    if (context.stepCount > context.maxSteps) {
      context.error = {
        message: `Maximum step limit of ${context.maxSteps} reached without finishing.`,
      };
      return "error";
    }

    if (res.toolCalls && res.toolCalls.length > 0) {
      context.pendingToolCalls = res.toolCalls;

      context.messages.push({
        role: "assistant",
        content: res.content || "",
        thought: res.thought,
        toolCalls: res.toolCalls,
      });

      context.history.push({
        step: context.stepCount,
        thought: res.thought,
        actions: res.toolCalls,
        observations: [],
        timestamp: Date.now(),
      });

      if (event.hasHumanApprovalRequired) {
        context.pendingHumanApprovals = [...res.toolCalls];
        return "awaiting_human";
      }

      return "awaiting_tool";
    }

    const responseContent = res.content ?? (res as any).text ?? "";
    context.finalResponse = responseContent;
    context.messages.push({
      role: "assistant",
      content: responseContent,
      thought: res.thought,
    });

    context.history.push({
      step: context.stepCount,
      thought: res.thought,
      actions: [],
      observations: [],
      timestamp: Date.now(),
    });

    return "done";
  }

  throw new Error(
    `Invalid event "${event.type}" received while in state "awaiting_model"`,
  );
}

function handleAwaitingTool(
  context: AgentContext,
  event: AgentEvent,
): AgentState {
  if (event.type === "TOOL_RESULTS") {
    const results = event.results;
    const currentStep = context.history[context.history.length - 1];
    if (currentStep) {
      currentStep.observations = results;
    }

    for (const result of results) {
      context.messages.push({
        role: "tool",
        toolCallId: result.toolCallId,
        name: result.name,
        content:
          typeof result.output === "string"
            ? result.output
            : JSON.stringify(result.output ?? result.error ?? null),
      });
    }

    context.pendingToolCalls = [];
    return "awaiting_model";
  }

  throw new Error(
    `Invalid event "${event.type}" received while in state "awaiting_tool"`,
  );
}

function handleAwaitingHuman(
  context: AgentContext,
  event: AgentEvent,
): AgentState {
  if (event.type === "HUMAN_APPROVED") {
    context.pendingHumanApprovals = [];
    return "awaiting_tool";
  }

  if (event.type === "HUMAN_REJECTED") {
    const rejectedResults: ToolResult[] = context.pendingToolCalls.map(
      (tc) => ({
        toolCallId: tc.id,
        name: tc.name,
        status: "rejected",
        output: null,
        error: event.reason || "Action was rejected by user.",
        metadata: { timestamp: Date.now() },
      }),
    );

    const currentStep = context.history[context.history.length - 1];
    if (currentStep) {
      currentStep.observations = rejectedResults;
    }

    for (const res of rejectedResults) {
      context.messages.push({
        role: "tool",
        toolCallId: res.toolCallId,
        name: res.name,
        content: JSON.stringify({ error: res.error, status: "rejected" }),
      });
    }

    context.pendingToolCalls = [];
    context.pendingHumanApprovals = [];
    return "awaiting_model";
  }

  throw new Error(
    `Invalid event "${event.type}" received while in state "awaiting_human"`,
  );
}
