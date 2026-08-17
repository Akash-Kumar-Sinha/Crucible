import { describe, it, expect } from "bun:test";
import { z } from "zod";
import {
  CrucibleClient,
  defineTool,
  ToolBuilder,
  HarnessConfigBuilder,
  SessionConfigBuilder,
  DoctorClient,
  zodToJsonSchema,
} from "./index";

describe("Crucible Developer SDK", () => {
  describe("Declarative Tools (defineTool & ToolBuilder)", () => {
    it("should define a tool with Zod schema and execute handler", async () => {
      const weatherTool = defineTool({
        name: "get_weather",
        description: "Get current weather for city",
        parameters: z.object({
          city: z.string().describe("City name"),
          unit: z.enum(["c", "f"]).default("c"),
        }),
        execute: async ({ city, unit }) => {
          return { city, temp: 24, unit };
        },
      });

      expect(weatherTool.name).toBe("get_weather");
      expect(weatherTool.category).toBe("custom");
      expect(weatherTool.version).toBe("1.0.0");

      const result = await weatherTool.execute({ city: "Tokyo", unit: "c" });
      expect(result).toEqual({ city: "Tokyo", temp: 24, unit: "c" });
    });

    it("should build a tool with ToolBuilder fluent interface", async () => {
      const tool = ToolBuilder.named("calculator")
        .withDescription("Math evaluator")
        .withParameters(
          z.object({
            expression: z.string(),
          }),
        )
        .withCategory("math")
        .withVersion("2.0.0")
        .requireApproval(true)
        .withHandler(async ({ expression }) => ({ result: eval(expression) }))
        .build();

      expect(tool.name).toBe("calculator");
      expect(tool.description).toBe("Math evaluator");
      expect(tool.category).toBe("math");
      expect(tool.version).toBe("2.0.0");
      expect(tool.requiresApproval).toBe(true);

      const res = await tool.execute({ expression: "10 * 5" });
      expect(res.result).toBe(50);
    });

    it("should convert Zod schema to JSON schema correctly", () => {
      const schema = z.object({
        query: z.string().describe("Search keyword"),
        limit: z.number().default(10),
      });

      const jsonSchema = zodToJsonSchema(schema);
      expect(jsonSchema.type).toBe("object");
      expect((jsonSchema.properties as any).query.type).toBe("string");
      expect((jsonSchema.properties as any).limit.type).toBe("number");
      expect(jsonSchema.required).toEqual(["query"]);
    });
  });

  describe("Builder Pattern (HarnessConfigBuilder & SessionConfigBuilder)", () => {
    it("should build harness client with customized configuration", () => {
      const tool = defineTool({
        name: "test_tool",
        description: "Test tool",
        parameters: z.object({}),
        execute: () => "ok",
      });

      const builder = HarnessConfigBuilder.create()
        .withEndpoint("https://crucible.example.com")
        .withApiKey("test-key-123")
        .withTenantId("tenant-alpha")
        .withNamespace("crucible-staging")
        .withTimeout(15000)
        .withTool(tool);

      expect(builder.getTools().length).toBe(1);
      const clientConfig = builder.getClientConfig();
      expect(clientConfig.endpoint).toBe("https://crucible.example.com");
      expect(clientConfig.apiKey).toBe("test-key-123");
      expect(clientConfig.tenantId).toBe("tenant-alpha");
      expect(clientConfig.namespace).toBe("crucible-staging");
      expect(clientConfig.timeoutMs).toBe(15000);

      const client = builder.buildClient();
      expect(client).toBeInstanceOf(CrucibleClient);
      expect(client.config.endpoint).toBe("https://crucible.example.com");
    });

    it("should build session configuration options", () => {
      const sessionOptions = SessionConfigBuilder.create()
        .withTitle("Bug Hunting Shift")
        .withRole("bug_hunter")
        .withModel("anthropic/claude-3.5-sonnet")
        .withTenantId("tenant-sec")
        .withNamespace("sec-sandbox")
        .withSystemPrompt("Audit all endpoints.")
        .withMetadata({ squadId: "squad_99" })
        .build();

      expect(sessionOptions.title).toBe("Bug Hunting Shift");
      expect(sessionOptions.role).toBe("bug_hunter");
      expect(sessionOptions.model).toBe("anthropic/claude-3.5-sonnet");
      expect(sessionOptions.tenantId).toBe("tenant-sec");
      expect(sessionOptions.namespace).toBe("sec-sandbox");
      expect(sessionOptions.systemPrompt).toBe("Audit all endpoints.");
      expect(sessionOptions.metadata?.squadId).toBe("squad_99");
    });
  });

  describe("Facade Pattern (CrucibleClient)", () => {
    it("should instantiate client and expose domain sub-facades", () => {
      const client = new CrucibleClient({
        endpoint: "http://localhost:4000",
        tenantId: "tenant_dev",
      });

      expect(client.sessions).toBeDefined();
      expect(client.tools).toBeDefined();
      expect(client.models).toBeDefined();
      expect(client.roles).toBeDefined();
      expect(client.sandbox).toBeDefined();
      expect(client.infra).toBeDefined();
      expect(client.doctor).toBeDefined();
      expect(client.metrics).toBeDefined();
      expect(client.traces).toBeDefined();
      expect(client.audit).toBeDefined();
    });

    it("should route session CRUD requests through facade with mocked fetch", async () => {
      const mockFetch = async (input: any, init?: any) => {
        const url = String(input);
        const method = init?.method || "GET";

        if (url.endsWith("/sessions") && method === "POST") {
          return new Response(
            JSON.stringify({
              id: "sess_mock_123",
              title: "Mock Session",
              status: "awaiting_model",
              createdAt: Date.now(),
            }),
            { status: 201, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url.endsWith("/sessions") && method === "GET") {
          return new Response(
            JSON.stringify({
              sessions: [
                { id: "sess_mock_123", title: "Mock Session", status: "done" },
              ],
              total: 1,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url.endsWith("/sessions/sess_mock_123") && method === "GET") {
          return new Response(
            JSON.stringify({
              id: "sess_mock_123",
              title: "Mock Session",
              status: "done",
              messages: [{ role: "user", content: "hello" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (
          url.endsWith("/sessions/sess_mock_123/messages") &&
          method === "POST"
        ) {
          return new Response(
            JSON.stringify({
              sessionId: "sess_mock_123",
              status: "done",
              response: "Hello from Crucible AI",
              turns: 1,
              steps: 2,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url.endsWith("/sessions/sess_mock_123") && method === "DELETE") {
          return new Response(
            JSON.stringify({ success: true, id: "sess_mock_123" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response("Not Found", { status: 404 });
      };

      const client = new CrucibleClient({
        endpoint: "http://mock-crucible.local",
        fetch: mockFetch,
      });

      const created = await client.sessions.create({ title: "Mock Session" });
      expect(created.id).toBe("sess_mock_123");

      const list = await client.sessions.list();
      expect(list.length).toBe(1);
      expect(list[0].id).toBe("sess_mock_123");

      const detail = await client.sessions.get("sess_mock_123");
      expect(detail.id).toBe("sess_mock_123");
      expect(detail.messages.length).toBe(1);

      const promptRes = await client.sessions.prompt(
        "sess_mock_123",
        "Hello agent",
      );
      expect(promptRes.response).toBe("Hello from Crucible AI");

      const deleted = await client.sessions.delete("sess_mock_123");
      expect(deleted).toBe(true);
    });
  });

  describe("Doctor Diagnostics (DoctorClient)", () => {
    it("should perform comprehensive health check and aggregate subsystem reports", async () => {
      const mockFetch = async (input: any) => {
        const url = String(input);

        if (url.endsWith("/healthz")) {
          return new Response(
            JSON.stringify({
              status: "healthy",
              service: "crucible-orchestrator",
              uptime: 123.45,
              system: {
                memoryMb: { rss: 64, heapTotal: 32, heapUsed: 16 },
                pid: 1234,
                runtime: "bun/1.3.8",
                dockerSocketPresent: true,
                grpcStatus: "online",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (url.endsWith("/readyz")) {
          return new Response(
            JSON.stringify({
              status: "healthy",
              service: "crucible-orchestrator",
              version: "0.1.0",
              uptime: 123.45,
              timestamp: new Date().toISOString(),
              checks: {
                orchestrator_loop: { status: "ok", latencyMs: 1 },
                openrouter_gateway: { status: "ok", latencyMs: 45 },
                execution_engine: { status: "ok", latencyMs: 2 },
                postgres_database: { status: "ok", latencyMs: 3 },
                redis_cache: { status: "ok", latencyMs: 1 },
                guardrails_policy_engine: { status: "ok", latencyMs: 1 },
                job_queue: { status: "ok", latencyMs: 2 },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response("Not Found", { status: 404 });
      };

      const doctor = new DoctorClient("http://crucible.local", {}, mockFetch);
      const diag = await doctor.runDiagnostics();

      expect(diag.overallHealthy).toBe(true);
      expect(diag.status).toBe("healthy");
      expect(diag.checks["liveness_probe"].status).toBe("ok");
      expect(diag.checks["openrouter_gateway"].status).toBe("ok");
      expect(diag.checks["postgres_database"].status).toBe("ok");
      expect(diag.remediationTips.length).toBe(0);
    });

    it("should flag degraded dependencies and generate actionable remediation tips", async () => {
      const mockFetch = async (input: any) => {
        const url = String(input);
        if (url.endsWith("/healthz")) {
          return new Response(
            JSON.stringify({ status: "healthy", uptime: 10 }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.endsWith("/readyz")) {
          return new Response(
            JSON.stringify({
              status: "degraded",
              checks: {
                openrouter_gateway: {
                  status: "degraded",
                  message: "API key unset or gateway unreachable",
                },
                rust_grpc_executor: {
                  status: "degraded",
                  message: "Rust gRPC executor service unreachable",
                },
              },
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Error", { status: 500 });
      };

      const doctor = new DoctorClient("http://crucible.local", {}, mockFetch);
      const diag = await doctor.runDiagnostics();

      expect(diag.overallHealthy).toBe(false);
      expect(diag.status).toBe("degraded");
      expect(diag.remediationTips.length).toBeGreaterThan(0);
      expect(
        diag.remediationTips.some((tip) => tip.includes("OPENROUTER_API_KEY")),
      ).toBe(true);
      expect(
        diag.remediationTips.some((tip) => tip.includes("Rust gRPC Executor")),
      ).toBe(true);
    });
  });

  describe("Extended Headless SDK Facades (Squads, Context, Audit, Metrics, Voice)", () => {
    it("should handle context usage inspection", async () => {
      const mockFetch = async (input: any) => {
        const url = String(input);
        if (url.includes("/sessions/sess_ctx_1")) {
          return new Response(
            JSON.stringify({
              id: "sess_ctx_1",
              status: "idle",
              messages: [{ role: "user", content: "hello" }],
              metadata: {
                contextWindow: {
                  totalTokens: 54000,
                  limit: 100000,
                  usagePercent: 54,
                  isSummarized: true,
                  summarizedTurnCount: 4,
                  runningSummary: "Prior code analysis complete",
                  strategyName: "memento",
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      };

      const client = new CrucibleClient({
        endpoint: "http://crucible.local",
        fetch: mockFetch,
      });
      const usage = await client.sessions.getContextUsage("sess_ctx_1");

      expect(usage.sessionId).toBe("sess_ctx_1");
      expect(usage.totalTokens).toBe(54000);
      expect(usage.limit).toBe(100000);
      expect(usage.usagePercent).toBe(54);
      expect(usage.isSummarized).toBe(true);
      expect(usage.strategyName).toBe("memento");
      expect(usage.runningSummary).toBe("Prior code analysis complete");
    });

    it("should handle audit trail streaming and cryptographic verification", async () => {
      const mockFetch = async (input: any) => {
        const url = String(input);
        if (url.includes("/audit/records")) {
          return new Response(
            JSON.stringify({
              total: 2,
              records: [
                {
                  id: "rec_1",
                  sequence: 1,
                  action: "bash_exec",
                  role: "bug_hunter",
                  sandboxed: true,
                  networkBlocked: true,
                  checksum: "abc123hash",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/audit/verify")) {
          return new Response(
            JSON.stringify({
              status: "success",
              integrity: {
                valid: true,
                totalRecords: 1,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      };

      const client = new CrucibleClient({
        endpoint: "http://crucible.local",
        fetch: mockFetch,
      });

      const records = await client.audit.getRecords();
      expect(records.length).toBe(1);
      expect(records[0].action).toBe("bash_exec");
      expect(records[0].sandboxed).toBe(true);

      const verification = await client.audit.verifyIntegrity();
      expect(verification.valid).toBe(true);
      expect(verification.totalRecords).toBe(1);
    });

    it("should handle plain-text metrics dashboard retrieval", async () => {
      const mockFetch = async (input: any) => {
        const url = String(input);
        if (url.includes("/metrics")) {
          return new Response(
            JSON.stringify({
              status: "success",
              data: {
                timestamp: "2026-08-17T00:00:00.000Z",
                tokens: {
                  totalPromptTokens: 1200,
                  totalCompletionTokens: 300,
                  totalTokens: 1500,
                },
                models: {
                  "claude-3.5-sonnet": {
                    requests: 5,
                    avgLatencyMs: 250,
                    errorRate: 0,
                  },
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      };

      const client = new CrucibleClient({
        endpoint: "http://crucible.local",
        fetch: mockFetch,
      });
      const metrics = await client.metrics.getSummary();

      expect(metrics.tokens?.totalTokens).toBe(1500);
      expect(metrics.models?.["claude-3.5-sonnet"].requests).toBe(5);
    });

    it("should handle voice tokens and audio transcription requests", async () => {
      const mockFetch = async (input: any, _init?: any) => {
        const url = String(input);
        if (url.includes("/voice/token")) {
          return new Response(
            JSON.stringify({
              status: "success",
              data: {
                token: "jwt_token_sample",
                roomName: "crucible_session_s1",
                participantIdentity: "user_s1",
                agentIdentity: "agent_stt_s1",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/voice/transcribe")) {
          return new Response(
            JSON.stringify({
              status: "success",
              data: {
                transcript: "Run tests",
                durationMs: 12,
                forwarded: true,
                agentState: "idle",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      };

      const client = new CrucibleClient({
        endpoint: "http://crucible.local",
        fetch: mockFetch,
      });
      const token = await client.voice.getToken("s1");
      expect(token.token).toBe("jwt_token_sample");

      const transcribe = await client.voice.transcribeAudio("s1", "dGVzdA==");
      expect(transcribe.transcript).toBe("Run tests");
      expect(transcribe.forwarded).toBe(true);
    });
  });
});
