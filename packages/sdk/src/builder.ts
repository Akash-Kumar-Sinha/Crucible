import type {
  ClientConfig,
  CreateSessionOptions,
  DeclarativeTool,
} from "./types";
import { CrucibleClient } from "./client";

export class SessionConfigBuilder {
  private options: CreateSessionOptions = {};

  private constructor() {}

  static create(): SessionConfigBuilder {
    return new SessionConfigBuilder();
  }

  withSessionId(id: string): this {
    this.options.sessionId = id;
    return this;
  }

  withTitle(title: string): this {
    this.options.title = title;
    return this;
  }

  withRole(role: string): this {
    this.options.role = role;
    return this;
  }

  withModel(model: string): this {
    this.options.model = model;
    return this;
  }

  withTenantId(tenantId: string): this {
    this.options.tenantId = tenantId;
    return this;
  }

  withNamespace(namespace: string): this {
    this.options.namespace = namespace;
    return this;
  }

  withSystemPrompt(systemPrompt: string): this {
    this.options.systemPrompt = systemPrompt;
    return this;
  }

  withMetadata(metadata: Record<string, unknown>): this {
    this.options.metadata = { ...this.options.metadata, ...metadata };
    return this;
  }

  build(): CreateSessionOptions {
    return { ...this.options };
  }
}

export class HarnessConfigBuilder {
  private config: ClientConfig = {
    endpoint: "http://localhost:4000",
    timeoutMs: 30000,
    headers: {},
  };
  private defaultModel?: string;
  private defaultRole?: string;
  private defaultSystemPrompt?: string;
  private customTools: DeclarativeTool[] = [];
  private executionMode: "local" | "docker" | "grpc" | "k8s" = "docker";
  private grpcAddress?: string;

  private constructor() {}

  static create(): HarnessConfigBuilder {
    return new HarnessConfigBuilder();
  }

  withEndpoint(endpoint: string): this {
    this.config.endpoint = endpoint;
    return this;
  }

  withApiKey(apiKey: string): this {
    this.config.apiKey = apiKey;
    return this;
  }

  withAuthToken(authToken: string): this {
    this.config.authToken = authToken;
    return this;
  }

  withTenantId(tenantId: string): this {
    this.config.tenantId = tenantId;
    return this;
  }

  withNamespace(namespace: string): this {
    this.config.namespace = namespace;
    return this;
  }

  withTimeout(timeoutMs: number): this {
    this.config.timeoutMs = timeoutMs;
    return this;
  }

  withHeader(name: string, value: string): this {
    this.config.headers = { ...this.config.headers, [name]: value };
    return this;
  }

  withHeaders(headers: Record<string, string>): this {
    this.config.headers = { ...this.config.headers, ...headers };
    return this;
  }

  withFetch(customFetch: typeof fetch): this {
    this.config.fetch = customFetch;
    return this;
  }

  withDefaultModel(model: string): this {
    this.defaultModel = model;
    return this;
  }

  withDefaultRole(role: string): this {
    this.defaultRole = role;
    return this;
  }

  withDefaultSystemPrompt(systemPrompt: string): this {
    this.defaultSystemPrompt = systemPrompt;
    return this;
  }

  withExecutionMode(mode: "local" | "docker" | "grpc" | "k8s"): this {
    this.executionMode = mode;
    return this;
  }

  withGrpcAddress(address: string): this {
    this.grpcAddress = address;
    return this;
  }

  withTool(tool: DeclarativeTool): this {
    this.customTools.push(tool);
    return this;
  }

  withTools(tools: DeclarativeTool[]): this {
    this.customTools.push(...tools);
    return this;
  }

  getTools(): DeclarativeTool[] {
    return [...this.customTools];
  }

  getClientConfig(): ClientConfig {
    return { ...this.config };
  }

  buildClient(): CrucibleClient {
    return new CrucibleClient({
      ...this.config,
      headers: {
        ...this.config.headers,
        ...(this.config.apiKey
          ? { Authorization: `Bearer ${this.config.apiKey}` }
          : {}),
        ...(this.config.authToken
          ? { "X-Crucible-Token": this.config.authToken }
          : {}),
        ...(this.config.tenantId
          ? { "X-Tenant-ID": this.config.tenantId }
          : {}),
        ...(this.config.namespace
          ? { "X-Namespace": this.config.namespace }
          : {}),
      },
    });
  }
}
