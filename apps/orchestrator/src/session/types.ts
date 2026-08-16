import type {
  AgentMessage,
  StepRecord,
  ToolCall,
  ToolResult,
} from "../schema/envelope";
import type { AgentState } from "../agent/state-machine/types";
import type { ModelProvider } from "../provider/provider.interface";
import type { ToolRegistry } from "../tools/registry";
import type { AgentLoopResult } from "../agent/loop";
import type { GuardrailChain } from "../guardrails/chain";

export type SessionId = string;

export type SessionStatus =
  "idle" | "queued" | "running" | "awaiting_human" | "done" | "error";

export interface SessionConfig {
  sessionId?: SessionId;
  title?: string;
  role?: string;
  tenantId?: string;
  namespace?: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxSteps?: number;
  provider?: ModelProvider;
  tools?: ToolRegistry;
  guardrails?: GuardrailChain;
  sessionBus?: any;
  metadata?: Record<string, unknown>;
  onHumanApprovalRequired?: (
    pendingCalls: ToolCall[],
  ) => Promise<boolean | { approved: boolean; reason?: string }>;
}

export interface SessionMetadata {
  id: SessionId;
  title?: string;
  role?: string;
  tenantId?: string;
  namespace?: string;
  createdAt: Date;
  updatedAt: Date;
  turnCount: number;
  customMetadata: Record<string, unknown>;
}

export interface SessionSummary {
  id: SessionId;
  title?: string;
  role?: string;
  tenantId?: string;
  namespace?: string;
  status: SessionStatus;
  agentState: AgentState;
  messageCount: number;
  stepCount: number;
  turnCount: number;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

export interface SessionEvents {
  stateChange: (current: AgentState, prev: AgentState) => void;
  statusChange: (current: SessionStatus, prev: SessionStatus) => void;
  thought: (thought: string) => void;
  action: (actions: ToolCall[]) => void;
  observation: (observations: ToolResult[]) => void;
  step: (record: StepRecord) => void;
  message: (message: AgentMessage) => void;
  done: (finalResponse: string, result: AgentLoopResult) => void;
  error: (error: { message: string; details?: unknown }) => void;
  humanApprovalRequired: (pendingCalls: ToolCall[]) => void;
}

export type CreateSessionOptions = SessionConfig;

export interface SessionManagerConfig {
  defaultProvider?: ModelProvider;
  defaultTools?: ToolRegistry;
  defaultGuardrails?: GuardrailChain;
  defaultSystemPrompt?: string;
  defaultMaxSteps?: number;
  defaultModel?: string;
  maxConcurrentSessions?: number;
  maxConcurrentExecutions?: number;
  sessionRepository?: any;
  runRepository?: any;
  redisStore?: any;
  autoPersist?: boolean;
  jobScheduler?: any;
  queueConfig?: any;
}

export interface SessionManagerEvents {
  sessionCreated: (sessionSummary: SessionSummary) => void;
  sessionDeleted: (sessionId: SessionId) => void;
  sessionStateChange: (sessionId: SessionId, state: AgentState) => void;
  sessionError: (
    sessionId: SessionId,
    error: { message: string; details?: unknown },
  ) => void;
}
