import { captureClientError } from "../lib/error-reporter";
import { getOrchestratorUrl } from "../config/orchestrator-url";
import type { TenantScope } from "../config/tenant-scope";

export interface SessionSummary {
  id: string;
  title: string;
  tenantId?: string;
  namespace?: string;
  status: string;
  agentState: string;
  messageCount: number;
  stepCount: number;
  turnCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ToolCall {
  id?: string;
  toolCallId?: string;
  name?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  args?: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId?: string;
  name?: string;
  status?: string;
  output?: unknown;
  error?: string;
}

export interface AgentMessage {
  role: "user" | "assistant" | "system" | "tool";
  content?: string;
  thought?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface SessionDetail {
  id: string;
  title: string;
  tenantId?: string;
  namespace?: string;
  status: string;
  createdAt: number;
  metadata: {
    title: string;
    tenantId?: string;
    namespace?: string;
    createdAt: number;
    turnCount: number;
    lastActiveAt: number;
  };
  stepCount: number;
  messages: AgentMessage[];
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

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

export class OrchestratorClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl || getOrchestratorUrl()).replace(/\/$/, "");
  }

  private async request<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const timeoutMs = options.timeoutMs ?? 10_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };

    let res: Response;
    try {
      res = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
    } catch (networkErr: unknown) {
      clearTimeout(timer);
      const networkError =
        networkErr instanceof Error
          ? networkErr
          : new Error(String(networkErr));
      const isTimeout =
        networkError.name === "AbortError" ||
        networkError.message.includes("aborted");
      const errorMsg = isTimeout
        ? `Request timed out after ${timeoutMs}ms while connecting to ${this.baseUrl}${path}.`
        : `Cannot connect to Crucible Core Server at ${this.baseUrl}. Please verify that 'make serve' is running.`;

      captureClientError(networkError, {
        action: "http_request",
        route: path,
        extra: { url, isTimeout, timeoutMs },
      });

      throw new Error(errorMsg, { cause: networkErr });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      let errorMessage = `HTTP error ${res.status}: ${res.statusText}`;
      let errorDetails: unknown;
      try {
        const errorData = await res.json();
        if (errorData?.error?.message) {
          errorMessage = errorData.error.message;
          errorDetails = errorData.error.details;
        }
      } catch {
        // fallback to status text
      }

      captureClientError(new Error(errorMessage), {
        action: "http_response_error",
        route: path,
        extra: { url, status: res.status, errorDetails },
      });

      throw new Error(errorMessage);
    }

    return res.json() as Promise<T>;
  }

  async listSessions(): Promise<SessionSummary[]> {
    return this.listSessionsWithScope();
  }

  async listSessionsWithScope(scope?: TenantScope): Promise<SessionSummary[]> {
    const searchParams = new URLSearchParams();
    if (scope?.tenantId) {
      searchParams.set("tenantId", scope.tenantId);
    }
    if (scope?.namespace) {
      searchParams.set("namespace", scope.namespace);
    }

    const query = searchParams.toString();
    const data = await this.request<{
      sessions: SessionSummary[];
      total: number;
    }>(query ? `/sessions?${query}` : "/sessions", { timeoutMs: 5_000 });
    return data.sessions || [];
  }

  async createSession(
    title?: string,
    systemPrompt?: string,
    scope?: TenantScope,
  ): Promise<{
    id: string;
    title: string;
    tenantId?: string;
    namespace?: string;
    status: string;
    createdAt: number;
  }> {
    return this.request<{
      id: string;
      title: string;
      tenantId?: string;
      namespace?: string;
      status: string;
      createdAt: number;
    }>("/sessions", {
      method: "POST",
      timeoutMs: 8_000,
      body: JSON.stringify({
        title: title || "New Conversation",
        systemPrompt,
        tenantId: scope?.tenantId,
        namespace: scope?.namespace,
      }),
    });
  }

  async getSession(id: string): Promise<SessionDetail> {
    return this.request<SessionDetail>(`/sessions/${id}`, { timeoutMs: 5_000 });
  }

  async sendMessage(id: string, message: string): Promise<SendMessageResponse> {
    return this.request<SendMessageResponse>(`/sessions/${id}/messages`, {
      method: "POST",
      timeoutMs: 90_000, // Agent execution turn timeout
      body: JSON.stringify({ message }),
    });
  }

  async approveGuardrailAction(
    sessionId: string,
    decision: {
      approved: boolean;
      reason?: string;
      toolCallId?: string;
      operatorId?: string;
      resume?: boolean;
    },
  ): Promise<{
    sessionId: string;
    action: "approved" | "rejected";
    operatorId?: string;
    state?: string;
    status?: string;
    durationMs?: number;
  }> {
    return this.request<{
      sessionId: string;
      action: "approved" | "rejected";
      operatorId?: string;
      state?: string;
      status?: string;
      durationMs?: number;
    }>(`/sessions/${sessionId}/approval`, {
      method: "POST",
      timeoutMs: 15_000,
      body: JSON.stringify(decision),
    });
  }

  async getSandboxInfo(sessionId?: string): Promise<{
    status: "active" | "standby";
    tier: string;
    executor: string;
    cgroups: {
      enabled: boolean;
      cpuQuota: string;
      memoryLimit: string;
      pidsLimit: number;
      memoryCurrent: string;
    };
    filesystem: {
      isolation: string;
      strategy: string;
      writableLayer: string;
      cleanup: string;
    };
    network: {
      policy: string;
      egress: string;
      protocols: string[];
      nftables: string;
    };
    guardrails: {
      status: string;
      activePolicies: string[];
      pendingHumanReview: boolean;
    };
  }> {
    const path = sessionId ? `/sessions/${sessionId}/sandbox` : "/sandbox/info";
    return this.request(path, { timeoutMs: 5_000 });
  }

  async deleteSession(id: string): Promise<{ success: boolean; id: string }> {
    return this.request<{ success: boolean; id: string }>(`/sessions/${id}`, {
      method: "DELETE",
      timeoutMs: 5_000,
    });
  }
}

export const orchestratorClient = new OrchestratorClient();
