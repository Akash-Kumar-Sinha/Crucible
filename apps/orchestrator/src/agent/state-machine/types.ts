import type {
  AgentMessage,
  StepRecord,
  ToolCall,
  ToolResult,
} from "../../schema/envelope";
import type { ModelResponse } from "../../provider/provider.interface";

export type AgentState =
  "awaiting_model" | "awaiting_tool" | "awaiting_human" | "done" | "error";

export interface AgentContext {
  sessionId: string;
  systemPrompt?: string;
  messages: AgentMessage[];
  history: StepRecord[];
  currentThought?: string;
  pendingToolCalls: ToolCall[];
  pendingHumanApprovals: ToolCall[];
  stepCount: number;
  maxSteps: number;
  finalResponse?: string;
  error?: {
    message: string;
    details?: unknown;
  };
}

export type AgentEvent =
  | { type: "START"; prompt: string }
  | {
      type: "MODEL_RESPONSE";
      response: ModelResponse;
      hasHumanApprovalRequired?: boolean;
    }
  | { type: "TOOL_RESULTS"; results: ToolResult[] }
  | { type: "HUMAN_APPROVED"; toolCallId?: string }
  | { type: "HUMAN_REJECTED"; toolCallId?: string; reason?: string }
  | { type: "ERROR"; message: string; details?: unknown }
  | { type: "ABORT"; reason?: string };

export type TransitionListener = (
  from: AgentState,
  to: AgentState,
  event: AgentEvent,
  context: AgentContext,
) => void;
