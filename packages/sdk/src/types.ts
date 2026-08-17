import type { z } from "zod";

export interface ClientConfig {
  endpoint: string;
  apiKey?: string;
  authToken?: string;
  tenantId?: string;
  namespace?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  fetch?: typeof fetch | ((input: any, init?: any) => Promise<Response>);
}

export interface CreateSessionOptions {
  sessionId?: string;
  title?: string;
  role?: string;
  model?: string;
  tenantId?: string;
  namespace?: string;
  systemPrompt?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionSummary {
  id: string;
  title?: string;
  role?: string;
  model?: string;
  tenantId?: string;
  namespace?: string;
  status: string;
  state?: string;
  turnCount?: number;
  stepCount?: number;
  messageCount?: number;
  createdAt?: string | number | Date;
  updatedAt?: string | number | Date;
  metadata?: Record<string, unknown>;
}

export interface MessagePayload {
  role: "user" | "assistant" | "system" | "tool";
  content?: string;
  thought?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments?: Record<string, unknown>;
  }>;
}

export interface SessionDetail {
  id: string;
  title?: string;
  role?: string;
  model?: string;
  tenantId?: string;
  namespace?: string;
  status: string;
  stepCount?: number;
  messages: MessagePayload[];
  lastSteps?: unknown[];
  metadata?: Record<string, unknown>;
  createdAt?: number;
}

export interface PromptOptions {
  async?: boolean;
  priority?: "critical" | "high" | "normal" | "low" | number;
}

export interface PromptResponse {
  sessionId: string;
  title?: string;
  status: string;
  response?: string;
  turns?: number;
  steps?: number;
  messages?: MessagePayload[];
  jobId?: string;
}

export interface ApprovalOptions {
  approved: boolean;
  reason?: string;
  toolCallId?: string;
  resume?: boolean;
}

export interface ApprovalResponse {
  sessionId: string;
  action: "approved" | "rejected";
  state: string;
  status: string;
  durationMs?: number;
}

export type StreamEvent =
  | { type: "token"; content: string; messageId?: string }
  | { type: "thought"; content: string }
  | {
      type: "action";
      actions: Array<{
        id: string;
        name: string;
        arguments?: Record<string, unknown>;
      }>;
    }
  | {
      type: "observation";
      observations: Array<{
        id: string;
        name: string;
        status: "success" | "error";
        output?: unknown;
        error?: unknown;
      }>;
    }
  | { type: "state_change"; state: string; from?: string }
  | { type: "status_change"; status: string }
  | { type: "done"; response?: string; turnCount?: number }
  | { type: "error"; message: string; details?: unknown };

export interface StreamHandlers {
  onToken?: (token: string) => void;
  onThought?: (thought: string) => void;
  onAction?: (
    actions: Array<{
      id: string;
      name: string;
      arguments?: Record<string, unknown>;
    }>,
  ) => void;
  onObservation?: (
    observations: Array<{
      id: string;
      name: string;
      status: "success" | "error";
      output?: unknown;
      error?: unknown;
    }>,
  ) => void;
  onStateChange?: (state: string, from?: string) => void;
  onStatusChange?: (status: string) => void;
  onDone?: (response?: string) => void;
  onError?: (error: Error | { message: string; details?: unknown }) => void;
}

export interface DeclarativeTool<TInput = any, TOutput = any> {
  name: string;
  description: string;
  parameters: z.ZodType<TInput> | Record<string, unknown>;
  execute: (input: TInput, context?: ToolContext) => Promise<TOutput> | TOutput;
  requiresApproval?: boolean | ((input: TInput) => boolean);
  category?: string;
  version?: string;
}

export interface ToolContext {
  sessionId?: string;
  turnId?: number;
  callId?: string;
  tenantId?: string;
  namespace?: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  category: string;
  version: string;
}

export type HealthCheckStatus = "healthy" | "degraded" | "unhealthy";

export interface DependencyCheck {
  status: "ok" | "degraded" | "failed";
  latencyMs?: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface DoctorDiagnosticResult {
  status: HealthCheckStatus;
  endpoint: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  system?: {
    memoryMb: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
    };
    pid: number;
    runtime: string;
    dockerSocketPresent?: boolean;
    grpcStatus?: "online" | "down";
  };
  checks: Record<string, DependencyCheck>;
  remediationTips: string[];
  overallHealthy: boolean;
}

export interface SandboxInfo {
  sessionId?: string;
  cgroups?: {
    cpuMax?: string;
    memoryMax?: string;
    pidsMax?: string;
  };
  overlayfs?: {
    lowerDir?: string;
    upperDir?: string;
    workDir?: string;
    mergedDir?: string;
  };
  network?: {
    airgap?: boolean;
    policy?: string;
    egressAllowlist?: string[];
  };
  container?: {
    exitCode?: number;
    restartCount?: number;
    oomKilled?: boolean;
  };
}

export interface InfraStatus {
  cluster?: {
    reachable: boolean;
    name?: string;
  };
  queue?: {
    activeConsumers: number;
    maxConcurrency: number;
    backlogCount: number;
    deadLetterCount: number;
    oldestJobAgeMs: number;
  };
  executionMode?: string;
  session?: {
    id: string;
    status: string;
    queuePosition?: number;
    estimatedWaitMs?: number;
  };
}

export interface ModelInfo {
  id: string;
  name: string;
  contextLength?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  free?: boolean;
}

export interface RoleInfo {
  id: string;
  name: string;
  description: string;
  defaultModel: string;
  allowedTools: string[];
  readOnly: boolean;
  tagColor?: string;
  capabilities?: string[];
}

export interface ContextUsageInfo {
  sessionId: string;
  totalTokens: number;
  limit: number;
  usagePercent: number;
  isSummarized: boolean;
  summarizedTurnCount: number;
  runningSummary?: string;
  strategyName?: string;
}

export interface AuditRecord {
  id: string;
  sequence: number;
  sessionId: string;
  squadId?: string;
  role: string;
  action: string;
  input: unknown;
  output?: string;
  error?: string;
  sandboxed: boolean;
  networkBlocked: boolean;
  readOnlyEnforced: boolean;
  timestamp: number;
  previousHash: string;
  checksum: string;
}

export interface AuditIntegrityResult {
  valid: boolean;
  totalRecords: number;
  brokenSequence?: number;
}

export interface MetricsSummary {
  timestamp: string;
  uptimeSeconds?: number;
  tokens?: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
  };
  models?: Record<
    string,
    {
      requests: number;
      avgLatencyMs: number;
      errorRate: number;
    }
  >;
  roles?: Record<
    string,
    {
      turns: number;
      toolCalls: number;
      errorRate: number;
    }
  >;
  queue?: {
    activeConsumers: number;
    maxConcurrency: number;
    backlogCount: number;
    deadLetterCount: number;
  };
  traces?: {
    activeTraces: number;
    totalSpans: number;
  };
  sessions?: {
    total: number;
    active: number;
  };
}
