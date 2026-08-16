import { captureClientError } from "../lib/error-reporter";
import { getOrchestratorUrl } from "../config/orchestrator-url";
import type { TenantScope } from "../config/tenant-scope";
export type { TenantScope };

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

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  contextLength: number;
  isFree: boolean;
  provider: string;
}

export interface RoleInfo {
  id: string;
  name: string;
  description: string;
  defaultModel: string;
  allowedTools: string[];
  readOnly: boolean;
  tagColor?: string;
  capabilities: string[];
}

export interface InterSessionMessage {
  id: string;
  sourceSessionId: string;
  targetSessionId: string;
  type: "delegation" | "result" | "query" | "event" | "notification";
  payload: Record<string, unknown>;
  timestamp: number;
  correlationId?: string;
  tenantId?: string;
}

export interface SquadInfo {
  id: string;
  name: string;
  stage:
    | "idle"
    | "coding"
    | "testing"
    | "auditing"
    | "fixing"
    | "completed"
    | "failed"
    | "stalled";
  statusLine: string;
  activeRole?: string;
  activeSessionId?: string;
  members: Record<
    string,
    { role: string; sessionId: string; model?: string; active: boolean }
  >;
  activeGoal?: string;
  fixIterationCount: number;
  maxFixIterations: number;
  createdAt: number;
  updatedAt: number;
  stageStartedAt: number;
  stageTimeoutMs: number;
  tenantId?: string;
  namespace?: string;
  history?: Array<{
    fromStage: string;
    toStage: string;
    timestamp: number;
    triggerRole?: string;
    targetRole?: string;
    reason: string;
  }>;
}

export interface AuditRecord {
  id: string;
  sequence: number;
  sessionId: string;
  squadId?: string;
  role: "bug_hunter" | string;
  action: string;
  input: Record<string, unknown> | string;
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

export interface PreviewInfo {
  sessionId: string;
  port: number;
  status: "idle" | "starting" | "ready" | "crashed" | "stopped";
  framework: "vite" | "static" | "react" | "next" | "html";
  targetUrl: string;
  proxiedPath: string;
  startedAt: number;
  lastActiveAt: number;
  error?: string;
}

export interface SessionDetail {
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
    lastActiveAt: number;
    contextWindow?: {
      totalTokens?: number;
      limit?: number;
      usagePercent?: number;
      isSummarized?: boolean;
      summarizedTurnCount?: number;
      runningSummary?: string;
      strategyName?: string;
    };
    [key: string]: unknown;
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
    } catch (fetchErr: any) {
      clearTimeout(timer);
      const isTimeout =
        fetchErr.name === "AbortError" ||
        fetchErr.message?.includes("aborted") ||
        fetchErr.message?.includes("timed out");
      const errorMessage = isTimeout
        ? `Request timed out after ${timeoutMs}ms while connecting to ${url}`
        : `Network connection failed while connecting to ${url}: ${fetchErr.message}`;

      captureClientError(new Error(errorMessage), {
        action: "http_network_failure",
        route: path,
        extra: { url, timeoutMs },
      });

      throw new Error(errorMessage, { cause: fetchErr });
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

  async listModels(): Promise<ModelInfo[]> {
    try {
      const data = await this.request<{
        status: string;
        data: ModelInfo[];
      }>("/models", { timeoutMs: 5_000 });
      return data.data || [];
    } catch {
      return [
        {
          id: "openrouter/free",
          name: "OpenRouter Free Auto-Router",
          description: "High-speed free tier auto-routing",
          contextLength: 32768,
          isFree: true,
          provider: "openrouter",
        },
        {
          id: "meta-llama/llama-3.3-70b-instruct:free",
          name: "Llama 3.3 70B Instruct (Free)",
          description: "Meta open instruction-tuned model",
          contextLength: 131072,
          isFree: true,
          provider: "meta-llama",
        },
        {
          id: "google/gemini-2.0-flash-exp:free",
          name: "Gemini 2.0 Flash Experimental (Free)",
          description: "Google multimodal reasoning model",
          contextLength: 1048576,
          isFree: true,
          provider: "google",
        },
        {
          id: "anthropic/claude-3.5-sonnet",
          name: "Claude 3.5 Sonnet",
          description: "State-of-the-art coding & reasoning",
          contextLength: 200000,
          isFree: false,
          provider: "anthropic",
        },
        {
          id: "openai/gpt-4o",
          name: "GPT-4o",
          description: "OpenAI flagship multimodal intelligence",
          contextLength: 128000,
          isFree: false,
          provider: "openai",
        },
        {
          id: "deepseek/deepseek-chat",
          name: "DeepSeek V3",
          description: "High-efficiency open reasoning",
          contextLength: 64000,
          isFree: false,
          provider: "deepseek",
        },
      ];
    }
  }

  async listRoles(): Promise<RoleInfo[]> {
    try {
      const data = await this.request<{
        status: string;
        data: RoleInfo[];
      }>("/roles", { timeoutMs: 5_000 });
      return data.data || [];
    } catch {
      return [
        {
          id: "coder",
          name: "Coder",
          description:
            "Autonomous software engineer with write & execution capabilities",
          defaultModel: "anthropic/claude-3.5-sonnet",
          allowedTools: [
            "bash_exec",
            "read_file",
            "write_file",
            "calculator",
            "get_current_time",
          ],
          readOnly: false,
          tagColor: "sky",
          capabilities: [
            "Feature implementation",
            "Refactoring",
            "Type-safe modeling",
          ],
        },
        {
          id: "test_writer",
          name: "Test Writer",
          description: "Quality assurance & test suite authoring specialist",
          defaultModel: "anthropic/claude-3.5-sonnet",
          allowedTools: [
            "bash_exec",
            "read_file",
            "write_file",
            "calculator",
            "get_current_time",
          ],
          readOnly: false,
          tagColor: "emerald",
          capabilities: [
            "Unit & integration tests",
            "Boundary tests",
            "Mocking",
          ],
        },
        {
          id: "bug_hunter",
          name: "Bug Hunter",
          description:
            "White-hat security & fault auditor (read-only diagnostics)",
          defaultModel: "deepseek/deepseek-chat",
          allowedTools: [
            "read_file",
            "bash_exec",
            "calculator",
            "get_current_time",
          ],
          readOnly: true,
          tagColor: "rose",
          capabilities: [
            "Vulnerability probing",
            "OWASP auditing",
            "Race conditions",
          ],
        },
        {
          id: "bug_fixer",
          name: "Bug Fixer",
          description: "Root-cause debugging & surgical patch specialist",
          defaultModel: "anthropic/claude-3.5-sonnet",
          allowedTools: [
            "bash_exec",
            "read_file",
            "write_file",
            "calculator",
            "get_current_time",
          ],
          readOnly: false,
          tagColor: "amber",
          capabilities: [
            "Root-cause debugging",
            "Surgical patches",
            "Regression avoidance",
          ],
        },
      ];
    }
  }

  async createSession(
    title?: string,
    systemPrompt?: string,
    scope?: TenantScope,
    model?: string,
    role?: string,
  ): Promise<{
    id: string;
    title: string;
    role?: string;
    model?: string;
    tenantId?: string;
    namespace?: string;
    status: string;
    createdAt: number;
  }> {
    return this.request<{
      id: string;
      title: string;
      role?: string;
      model?: string;
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
        model,
        role,
      }),
    });
  }

  async getInterSessionMessages(limit = 50): Promise<{
    messages: InterSessionMessage[];
    metrics: {
      activeSubscribers: number;
      totalPublished: number;
      totalDelivered: number;
      totalUndeliverable: number;
      deadLetterCount: number;
    };
    deadLetters: InterSessionMessage[];
  }> {
    try {
      const data = await this.request<{
        status: string;
        data: {
          messages: InterSessionMessage[];
          metrics: any;
          deadLetters: InterSessionMessage[];
        };
      }>(`/inter-session/messages?limit=${limit}`, { timeoutMs: 4_000 });
      return (
        data.data || {
          messages: [],
          metrics: {
            activeSubscribers: 0,
            totalPublished: 0,
            totalDelivered: 0,
            totalUndeliverable: 0,
            deadLetterCount: 0,
          },
          deadLetters: [],
        }
      );
    } catch {
      return {
        messages: [],
        metrics: {
          activeSubscribers: 0,
          totalPublished: 0,
          totalDelivered: 0,
          totalUndeliverable: 0,
          deadLetterCount: 0,
        },
        deadLetters: [],
      };
    }
  }

  async getSession(id: string): Promise<SessionDetail> {
    return this.request<SessionDetail>(`/sessions/${id}`, { timeoutMs: 5_000 });
  }

  async sendMessage(
    id: string,
    message: string,
    options: { async?: boolean; timeoutMs?: number } = {},
  ): Promise<SendMessageResponse> {
    return this.request<SendMessageResponse>(`/sessions/${id}/messages`, {
      method: "POST",
      timeoutMs: options.timeoutMs ?? 300_000,
      body: JSON.stringify({ message, async: options.async }),
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

  async getInfraStatus(
    sessionId?: string,
    scope?: TenantScope,
  ): Promise<{
    status: "success";
    timestamp: string;
    sessionId?: string;
    data: {
      kubernetes: {
        clusterConnected: boolean;
        namespace: string;
        tenantId: string;
        activeJobs: number;
        quota: {
          cpuLimit: string;
          memoryLimit: string;
          maxPods: number;
          maxJobs: number;
        };
        job?: {
          jobName?: string;
          podName?: string;
          phase: string;
          nodeName?: string;
          oomKilled?: boolean;
          evicted?: boolean;
          startTime?: string;
          durationMs?: number;
        };
      };
      queue: {
        jobId?: string;
        status: "idle" | "queued" | "processing" | "completed" | "dead_letter";
        position: number;
        backlogCount: number;
        activeConsumers: number;
        maxConcurrency: number;
        oldestJobAgeMs: number;
        estimatedWaitMs: number;
      };
      tenant: {
        activeTenantId: string;
        activeNamespace: string;
        availableTenants: string[];
        availableNamespaces: string[];
      };
    };
  }> {
    const searchParams = new URLSearchParams();
    if (scope?.tenantId) searchParams.set("tenantId", scope.tenantId);
    if (scope?.namespace) searchParams.set("namespace", scope.namespace);
    const query = searchParams.toString();
    const basePath = sessionId
      ? `/sessions/${sessionId}/infra-status`
      : "/infra/status";
    const path = query ? `${basePath}?${query}` : basePath;
    return this.request(path, { timeoutMs: 5_000 });
  }

  async getSquads(): Promise<{ squads: SquadInfo[]; count: number }> {
    return this.request("/squads", { timeoutMs: 5_000 });
  }

  async getSquad(squadId: string): Promise<{ squad: SquadInfo }> {
    return this.request(`/squads/${encodeURIComponent(squadId)}`, {
      timeoutMs: 5_000,
    });
  }

  async createSquad(
    config: Partial<SquadInfo> & { name: string; autoCreateSessions?: boolean },
  ): Promise<{ squad: SquadInfo; message: string }> {
    return this.request("/squads", {
      method: "POST",
      body: JSON.stringify(config),
      timeoutMs: 10_000,
    });
  }

  async startSquad(
    squadId: string,
    goal: string,
  ): Promise<{ squad: SquadInfo; message: string }> {
    return this.request(`/squads/${encodeURIComponent(squadId)}/start`, {
      method: "POST",
      body: JSON.stringify({ goal }),
      timeoutMs: 10_000,
    });
  }

  async transitionSquad(
    squadId: string,
    toStage: string,
    reason: string,
  ): Promise<{ squad: SquadInfo; message: string }> {
    return this.request(`/squads/${encodeURIComponent(squadId)}/transition`, {
      method: "POST",
      body: JSON.stringify({ toStage, reason }),
      timeoutMs: 10_000,
    });
  }

  async getAuditRecords(params?: {
    sessionId?: string;
    squadId?: string;
    limit?: number;
  }): Promise<{
    status: string;
    records: AuditRecord[];
    total: number;
    integrity: AuditIntegrityResult;
  }> {
    const searchParams = new URLSearchParams();
    if (params?.sessionId) searchParams.set("sessionId", params.sessionId);
    if (params?.squadId) searchParams.set("squadId", params.squadId);
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    const query = searchParams.toString();
    const path = query ? `/audit/records?${query}` : "/audit/records";
    return this.request(path, { timeoutMs: 5_000 });
  }

  async verifyAuditIntegrity(): Promise<{
    status: string;
    integrity: AuditIntegrityResult;
  }> {
    return this.request("/audit/verify", { timeoutMs: 5_000 });
  }

  async getPreviewStatus(sessionId: string): Promise<{
    status: string;
    active: boolean;
    preview: PreviewInfo | null;
  }> {
    return this.request(`/preview/${encodeURIComponent(sessionId)}/status`, {
      timeoutMs: 5_000,
    });
  }

  async startPreview(
    sessionId: string,
    options?: { port?: number; framework?: string; staticHtml?: string },
  ): Promise<{ status: string; preview: PreviewInfo }> {
    return this.request(`/preview/${encodeURIComponent(sessionId)}/start`, {
      method: "POST",
      body: JSON.stringify(options || {}),
      timeoutMs: 10_000,
    });
  }

  async stopPreview(
    sessionId: string,
  ): Promise<{ status: string; stopped: boolean }> {
    return this.request(`/preview/${encodeURIComponent(sessionId)}/stop`, {
      method: "POST",
      timeoutMs: 5_000,
    });
  }

  getPreviewUrl(sessionId: string): string {
    return `${getOrchestratorUrl()}/preview/${encodeURIComponent(sessionId)}/`;
  }
}

export const orchestratorClient = new OrchestratorClient();
