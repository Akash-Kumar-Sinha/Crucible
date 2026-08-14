import { captureClientError } from "../lib/error-reporter";

export interface SessionSummary {
  id: string;
  title: string;
  status: string;
  agentState: string;
  messageCount: number;
  stepCount: number;
  turnCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentMessage {
  role: "user" | "assistant" | "system" | "tool";
  content?: string;
  thought?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  toolCallId?: string;
  name?: string;
}

export interface SessionDetail {
  id: string;
  title: string;
  status: string;
  createdAt: number;
  metadata: {
    title: string;
    createdAt: number;
    turnCount: number;
    lastActiveAt: number;
  };
  stepCount: number;
  messages: AgentMessage[];
}

export interface SendMessageResponse {
  sessionId: string;
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
    if (baseUrl) {
      this.baseUrl = baseUrl.replace(/\/$/, "");
    } else if (
      typeof process !== "undefined" &&
      process.env.NEXT_PUBLIC_ORCHESTRATOR_URL
    ) {
      this.baseUrl = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL.replace(
        /\/$/,
        "",
      );
    } else {
      this.baseUrl = "http://localhost:4000";
    }
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
    } catch (networkErr: any) {
      clearTimeout(timer);
      const isTimeout =
        networkErr.name === "AbortError" ||
        networkErr.message?.includes("aborted");
      const errorMsg = isTimeout
        ? `Request timed out after ${timeoutMs}ms while connecting to ${this.baseUrl}${path}.`
        : `Cannot connect to Crucible Core Server at ${this.baseUrl}. Please verify that 'make serve' is running.`;

      captureClientError(networkErr, {
        action: "http_request",
        route: path,
        extra: { url, isTimeout, timeoutMs },
      });

      throw new Error(errorMsg);
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
    const data = await this.request<{
      sessions: SessionSummary[];
      total: number;
    }>("/sessions", { timeoutMs: 5_000 });
    return data.sessions || [];
  }

  async createSession(
    title?: string,
    systemPrompt?: string,
  ): Promise<{ id: string; title: string; status: string; createdAt: number }> {
    return this.request<{
      id: string;
      title: string;
      status: string;
      createdAt: number;
    }>("/sessions", {
      method: "POST",
      timeoutMs: 8_000,
      body: JSON.stringify({
        title: title || "New Conversation",
        systemPrompt,
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

  async deleteSession(id: string): Promise<{ success: boolean; id: string }> {
    return this.request<{ success: boolean; id: string }>(`/sessions/${id}`, {
      method: "DELETE",
      timeoutMs: 5_000,
    });
  }
}

export const orchestratorClient = new OrchestratorClient();
