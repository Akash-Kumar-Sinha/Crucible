import { consumeSseStream } from "./streaming";
import { DoctorClient } from "./doctor";
import { defineTool, ToolBuilder } from "./tools";
import { HarnessConfigBuilder, SessionConfigBuilder } from "./builder";
import type {
  ApprovalOptions,
  ApprovalResponse,
  AuditIntegrityResult,
  AuditRecord,
  ClientConfig,
  ContextUsageInfo,
  CreateSessionOptions,
  DoctorDiagnosticResult,
  InfraStatus,
  MetricsSummary,
  ModelInfo,
  PromptOptions,
  PromptResponse,
  RoleInfo,
  SandboxInfo,
  SessionDetail,
  SessionSummary,
  StreamHandlers,
  ToolInfo,
} from "./types";

export class CrucibleClient {
  readonly config: ClientConfig;
  readonly doctor: DoctorClient;
  private readonly fetchFn:
    typeof fetch | ((input: any, init?: any) => Promise<Response>);

  constructor(config: Partial<ClientConfig> | string = {}) {
    const rawEndpoint =
      typeof config === "string"
        ? config
        : config.endpoint ||
          process.env.CRUCIBLE_ENDPOINT ||
          "http://localhost:4000";

    this.config = {
      endpoint: rawEndpoint.replace(/\/+$/, ""),
      apiKey: typeof config === "object" ? config.apiKey : undefined,
      authToken: typeof config === "object" ? config.authToken : undefined,
      tenantId: typeof config === "object" ? config.tenantId : undefined,
      namespace: typeof config === "object" ? config.namespace : undefined,
      timeoutMs:
        (typeof config === "object" ? config.timeoutMs : undefined) || 30000,
      headers: (typeof config === "object" ? config.headers : undefined) || {},
      fetch: typeof config === "object" ? config.fetch : undefined,
    };

    this.fetchFn = this.config.fetch || globalThis.fetch;
    this.doctor = new DoctorClient(
      this.config.endpoint,
      this.buildHeaders(),
      this.fetchFn,
    );
  }

  static builder(): HarnessConfigBuilder {
    return HarnessConfigBuilder.create();
  }

  static sessionBuilder(): SessionConfigBuilder {
    return SessionConfigBuilder.create();
  }

  static defineTool = defineTool;
  static toolBuilder = ToolBuilder.named;

  private buildHeaders(
    extra: Record<string, string> = {},
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.config.headers,
      ...extra,
    };

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }
    if (this.config.authToken) {
      headers["X-Crucible-Token"] = this.config.authToken;
    }
    if (this.config.tenantId) {
      headers["X-Tenant-ID"] = this.config.tenantId;
    }
    if (this.config.namespace) {
      headers["X-Namespace"] = this.config.namespace;
    }

    return headers;
  }

  private async request<T = any>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const url = `${this.config.endpoint}${cleanPath}`;
    const timeoutMs = this.config.timeoutMs || 30000;

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchFn(url, {
        ...options,
        headers: this.buildHeaders(
          (options.headers as Record<string, string>) || {},
        ),
        signal: options.signal || controller.signal,
      });
      clearTimeout(timeoutTimer);

      if (!response.ok) {
        let errData: any;
        try {
          errData = await response.json();
        } catch {
          errData = { message: await response.text() };
        }
        const errorMsg =
          errData?.error?.message ||
          errData?.message ||
          `HTTP ${response.status} ${response.statusText}`;
        const error = new Error(errorMsg);
        (error as any).status = response.status;
        (error as any).details = errData;
        throw error;
      }

      return (await response.json()) as T;
    } catch (err: any) {
      clearTimeout(timeoutTimer);
      throw err;
    }
  }

  // -------------------------------------------------------------
  // Sessions Sub-Facade
  // -------------------------------------------------------------
  readonly sessions = {
    create: async (
      options: CreateSessionOptions = {},
    ): Promise<SessionSummary> => {
      const payload = {
        title: options.title,
        role: options.role,
        model: options.model,
        tenantId: options.tenantId || this.config.tenantId,
        namespace: options.namespace || this.config.namespace,
        systemPrompt: options.systemPrompt,
        metadata: options.metadata,
      };
      return this.request<SessionSummary>("/sessions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },

    list: async (filter?: {
      tenantId?: string;
      namespace?: string;
    }): Promise<SessionSummary[]> => {
      const params = new URLSearchParams();
      if (filter?.tenantId) params.set("tenantId", filter.tenantId);
      if (filter?.namespace) params.set("namespace", filter.namespace);
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await this.request<{
        sessions: SessionSummary[];
        total: number;
      }>(`/sessions${query}`);
      return res.sessions || [];
    },

    get: async (sessionId: string): Promise<SessionDetail> => {
      return this.request<SessionDetail>(`/sessions/${sessionId}`);
    },

    delete: async (sessionId: string): Promise<boolean> => {
      const res = await this.request<{ success: boolean }>(
        `/sessions/${sessionId}`,
        {
          method: "DELETE",
        },
      );
      return Boolean(res.success);
    },

    prompt: async (
      sessionId: string,
      message: string,
      options: PromptOptions = {},
    ): Promise<PromptResponse> => {
      return this.request<PromptResponse>(`/sessions/${sessionId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          message,
          async: options.async,
          priority: options.priority,
        }),
      });
    },

    stream: async (
      sessionId: string,
      handlers: StreamHandlers = {},
      signal?: AbortSignal,
    ): Promise<string> => {
      const url = `${this.config.endpoint}/sessions/${sessionId}/stream`;
      const response = await this.fetchFn(url, {
        method: "GET",
        headers: this.buildHeaders({ Accept: "text/event-stream" }),
        signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(
          `Failed to open stream for session ${sessionId}: HTTP ${response.status} ${response.statusText}`,
        );
      }

      return consumeSseStream(response.body, handlers, signal);
    },

    approve: async (
      sessionId: string,
      options: ApprovalOptions,
    ): Promise<ApprovalResponse> => {
      return this.request<ApprovalResponse>(`/sessions/${sessionId}/approval`, {
        method: "POST",
        body: JSON.stringify(options),
      });
    },

    getContextUsage: async (sessionId: string): Promise<ContextUsageInfo> => {
      const session = await this.sessions.get(sessionId);
      const meta = (session.metadata?.contextWindow as any) || {};
      const totalTokens = meta.totalTokens ?? 0;
      const limit = meta.limit ?? 200000;
      const usagePercent =
        meta.usagePercent ??
        Math.min(100, Math.round((totalTokens / limit) * 100));

      return {
        sessionId,
        totalTokens,
        limit,
        usagePercent,
        isSummarized: Boolean(meta.isSummarized),
        summarizedTurnCount: meta.summarizedTurnCount ?? 0,
        runningSummary: meta.runningSummary,
        strategyName: meta.strategyName || "hybrid",
      };
    },

    getSandboxInfo: async (sessionId: string): Promise<SandboxInfo> => {
      const res = await this.request<{ status: string; data: SandboxInfo }>(
        `/sessions/${sessionId}/sandbox`,
      );
      return res.data;
    },

    getInfraStatus: async (sessionId: string): Promise<InfraStatus> => {
      const res = await this.request<{ status: string; data: InfraStatus }>(
        `/sessions/${sessionId}/infra-status`,
      );
      return res.data;
    },
  };

  // -------------------------------------------------------------
  // Voice Sub-Facade
  // -------------------------------------------------------------
  readonly voice = {
    getToken: async (
      sessionId: string,
      options?: { participantName?: string; ttlSeconds?: number },
    ): Promise<{
      token: string;
      wsUrl: string;
      httpUrl: string;
      roomName: string;
      participantIdentity: string;
      expiresAt: number;
      agentIdentity: string;
      agentState: string;
    }> => {
      const res = await this.request<{
        status: string;
        data: {
          token: string;
          wsUrl: string;
          httpUrl: string;
          roomName: string;
          participantIdentity: string;
          expiresAt: number;
          agentIdentity: string;
          agentState: string;
        };
      }>(`/sessions/${encodeURIComponent(sessionId)}/voice/token`, {
        method: "POST",
        body: JSON.stringify(options || {}),
      });
      return res.data;
    },

    transcribeAudio: async (
      sessionId: string,
      audioBase64: string,
      mimeType = "audio/webm",
    ): Promise<{
      transcript: string;
      durationMs: number;
      forwarded: boolean;
      agentState: string;
    }> => {
      const res = await this.request<{
        status: string;
        data: {
          transcript: string;
          durationMs: number;
          forwarded: boolean;
          agentState: string;
        };
      }>(`/sessions/${encodeURIComponent(sessionId)}/voice/transcribe`, {
        method: "POST",
        body: JSON.stringify({ audioBase64, mimeType }),
      });
      return res.data;
    },

    getSessionStatus: async (sessionId: string): Promise<any> => {
      const res = await this.request<{ status: string; data: any }>(
        `/sessions/${encodeURIComponent(sessionId)}/voice/status`,
      );
      return res.data;
    },

    getGlobalStatus: async (): Promise<any> => {
      const res = await this.request<{ status: string; data: any }>(
        "/voice/status",
      );
      return res.data;
    },
  };

  // -------------------------------------------------------------
  // Tools Sub-Facade
  // -------------------------------------------------------------
  readonly tools = {
    define: defineTool,
    builder: ToolBuilder.named,

    list: async (): Promise<ToolInfo[]> => {
      const res = await this.request<{
        status: string;
        count: number;
        data: ToolInfo[];
      }>("/tools");
      return res.data || [];
    },

    get: async (name: string): Promise<ToolInfo> => {
      const res = await this.request<{ status: string; data: ToolInfo }>(
        `/tools/${name}`,
      );
      return res.data;
    },
  };

  // -------------------------------------------------------------
  // Models Sub-Facade
  // -------------------------------------------------------------
  readonly models = {
    list: async (): Promise<ModelInfo[]> => {
      const res = await this.request<{ status: string; data: ModelInfo[] }>(
        "/models",
      );
      return res.data || [];
    },
  };

  // -------------------------------------------------------------
  // Roles Sub-Facade
  // -------------------------------------------------------------
  readonly roles = {
    list: async (): Promise<RoleInfo[]> => {
      const res = await this.request<{ status: string; data: RoleInfo[] }>(
        "/roles",
      );
      return res.data || [];
    },

    get: async (roleId: string): Promise<RoleInfo> => {
      const res = await this.request<{ status: string; data: RoleInfo }>(
        `/roles/${roleId}`,
      );
      return res.data;
    },
  };

  // -------------------------------------------------------------
  // Sandbox & Infrastructure Sub-Facade
  // -------------------------------------------------------------
  readonly sandbox = {
    getInfo: async (sessionId?: string): Promise<SandboxInfo> => {
      const path = sessionId
        ? `/sessions/${sessionId}/sandbox`
        : "/sandbox/info";
      const res = await this.request<{ status: string; data: SandboxInfo }>(
        path,
      );
      return res.data;
    },
  };

  readonly infra = {
    getStatus: async (sessionId?: string): Promise<InfraStatus> => {
      const path = sessionId
        ? `/sessions/${sessionId}/infra-status`
        : "/infra/status";
      const res = await this.request<{ status: string; data: InfraStatus }>(
        path,
      );
      return res.data;
    },

    getQueueMetrics: async (): Promise<any> => {
      const res = await this.request<{ status: string; data: any }>(
        "/queue/metrics",
      );
      return res.data;
    },

    listQueueJobs: async (
      filter: Record<string, string> = {},
    ): Promise<any[]> => {
      const params = new URLSearchParams(filter);
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await this.request<{
        status: string;
        count: number;
        data: any[];
      }>(`/queue/jobs${query}`);
      return res.data || [];
    },

    retryDeadLetterJob: async (jobId: string): Promise<any> => {
      const res = await this.request<{ status: string; data: any }>(
        `/queue/jobs/${jobId}/retry`,
        {
          method: "POST",
        },
      );
      return res.data;
    },
  };

  // -------------------------------------------------------------
  // Observability & Distributed Tracing Sub-Facade
  // -------------------------------------------------------------
  readonly metrics = {
    getSummary: async (sessionId?: string): Promise<MetricsSummary> => {
      const query = sessionId ? `?sessionId=${sessionId}` : "";
      const res = await this.request<{ status: string; data: MetricsSummary }>(
        `/metrics${query}`,
      );
      return res.data;
    },
  };

  readonly traces = {
    getSpans: async (
      options: { sessionId?: string; traceId?: string; limit?: number } = {},
    ): Promise<any[]> => {
      const params = new URLSearchParams();
      if (options.sessionId) params.set("sessionId", options.sessionId);
      if (options.traceId) params.set("traceId", options.traceId);
      if (options.limit) params.set("limit", String(options.limit));
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await this.request<{
        status: string;
        count: number;
        data: any[];
      }>(`/traces${query}`);
      return res.data || [];
    },
  };

  readonly audit = {
    getRecords: async (
      options: { sessionId?: string; squadId?: string; limit?: number } = {},
    ): Promise<AuditRecord[]> => {
      const params = new URLSearchParams();
      if (options.sessionId) params.set("sessionId", options.sessionId);
      if (options.squadId) params.set("squadId", options.squadId);
      if (options.limit) params.set("limit", String(options.limit));
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await this.request<{
        status: string;
        total: number;
        records: AuditRecord[];
      }>(`/audit/records${query}`);
      return res.records || [];
    },

    verifyIntegrity: async (): Promise<AuditIntegrityResult> => {
      const res = await this.request<{
        status: string;
        integrity: AuditIntegrityResult;
      }>("/audit/verify");
      return res.integrity;
    },
  };

  async runDoctor(
    options: { timeoutMs?: number } = {},
  ): Promise<DoctorDiagnosticResult> {
    return this.doctor.runDiagnostics(options);
  }
}

export const Crucible = CrucibleClient;
