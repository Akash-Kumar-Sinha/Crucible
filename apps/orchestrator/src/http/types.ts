import type { AgentMessage, StepRecord } from "../schema/envelope";
import type { SessionSummary } from "../session/types";

export interface CreateSessionRequest {
  title?: string;
  role?: string;
  model?: string;
  tenantId?: string;
  namespace?: string;
  systemPrompt?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateSessionResponse {
  id: string;
  title: string;
  role?: string;
  model?: string;
  tenantId?: string;
  namespace?: string;
  status: string;
  createdAt: number;
}

export interface SessionListResponse {
  sessions: SessionSummary[];
  total: number;
}

export interface SessionDetailResponse {
  id: string;
  title: string;
  role?: string;
  model?: string;
  tenantId?: string;
  namespace?: string;
  status: string;
  createdAt: number;
  metadata: {
    title: string;
    role?: string;
    model?: string;
    tenantId?: string;
    namespace?: string;
    createdAt: number;
    turnCount: number;
    updatedAt: number;
    customMetadata?: Record<string, unknown>;
  };
  stepCount: number;
  messages: AgentMessage[];
  lastSteps?: StepRecord[];
}

export interface SendMessageRequest {
  message: string;
}

export interface SendMessageResponse {
  sessionId: string;
  title?: string;
  status: string;
  response: string;
  turns: number;
  steps: number;
  messages: AgentMessage[];
}

export interface HttpErrorEnvelope {
  status: "error";
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
