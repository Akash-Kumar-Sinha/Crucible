import type { Server } from "bun";
import { SessionManager } from "../session/session-manager";
import { ToolRegistry } from "../tools/registry";
import {
  calculatorTool,
  getCurrentTimeTool,
  createBashTool,
  readFileTool,
} from "../tools/builtin";
import { OpenRouterProvider, MockModelProvider } from "../provider";
import {
  LocalExecutor,
  DockerExecutor,
  GrpcExecutor,
  KubernetesJobExecutor,
} from "../execution";
import { SessionRouteHandler } from "./routes/sessions";
import {
  handleHealthzRequest,
  handleReadyzRequest,
  performLivenessCheck,
} from "../observability/health";
import { getErrorReporter } from "../observability/error-reporter";
import {
  SseStreamHandler,
  WebSocketGateway,
  type WsConnectionData,
} from "../streaming";
import {
  SessionRepository,
  RunRepository,
  RedisSessionStore,
} from "../persistence";
import { logger } from "../observability/logger";
import { GuardrailRouteHandler } from "./routes/guardrails";
import { InfraStatusRouteHandler } from "./routes/infra-status";
import { ModelsRouteHandler } from "./routes/models";
import { RolesRouteHandler } from "./routes/roles";
import { ToolsRouteHandler } from "./routes/tools";
import { AuditRouteHandler } from "./routes/audit";
import { VoiceRouteHandler } from "./routes/voice";
import { ResilienceRouteHandler } from "./routes/resilience";
import { getRateLimiter } from "../resilience/rate-limiter";

export interface HttpServerOptions {
  port?: number;
  hostname?: string;
  sessionManager?: SessionManager;
}

export function createHttpRouter(
  sessionManager: SessionManager,
  sseHandler: SseStreamHandler = new SseStreamHandler(sessionManager),
) {
  const handler = new SessionRouteHandler(sessionManager);
  const guardrailHandler = new GuardrailRouteHandler(sessionManager);
  const infraStatusHandler = new InfraStatusRouteHandler(sessionManager);
  const modelsHandler = new ModelsRouteHandler();
  const rolesHandler = new RolesRouteHandler();
  const toolsHandler = new ToolsRouteHandler(sessionManager);
  const auditHandler = new AuditRouteHandler();
  const voiceHandler = new VoiceRouteHandler(sessionManager);
  const resilienceHandler = new ResilienceRouteHandler();

  return async (
    req: Request,
    server?: Server<WsConnectionData>,
  ): Promise<Response> => {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const pathname = url.pathname;

    // Handle CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, X-Tenant-ID, X-Namespace, X-Crucible-Token",
        },
      });
    }

    // WebSocket upgrade endpoint
    if ((pathname === "/ws" || pathname === "/api/ws") && server) {
      const sessionId = url.searchParams.get("sessionId") || undefined;
      const success = server.upgrade(req, {
        data: {
          sessionId,
          subscribedSessions: sessionId ? new Set([sessionId]) : new Set(),
          connectedAt: new Date(),
        },
      });
      if (success) {
        return new Response(null, { status: 101 });
      }
    }

    // Liveness probe (/healthz or /livez)
    if (
      pathname === "/healthz" ||
      pathname === "/livez" ||
      pathname === "/api/healthz" ||
      pathname === "/api/livez"
    ) {
      return await handleHealthzRequest();
    }

    // Readiness probe (/readyz)
    if (pathname === "/readyz" || pathname === "/api/readyz") {
      return handleReadyzRequest();
    }

    // General health check (includes streaming & queue metrics)
    if (pathname === "/health" || pathname === "/api/health") {
      const liveness = performLivenessCheck();
      const sseMetrics = sseHandler.getMetrics();
      const queueMetrics = sessionManager.getQueueMetrics();
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "crucible-orchestrator",
          uptime: liveness.uptime,
          timestamp: liveness.timestamp,
          system: liveness.system,
          streaming: {
            activeSse: sseMetrics.activeSseConnections,
            totalSseOpened: sseMetrics.totalSseConnectionsOpened,
            droppedSse: sseMetrics.droppedSseConnections,
          },
          queue: queueMetrics,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }

    // Normalize path to strip leading /api prefix if present
    const normalizedPath = pathname.replace(/^\/api/, "");

    // Rate Limiting Interceptor on mutating routes (messages, dispatches, voice transcription)
    if (
      method === "POST" &&
      (normalizedPath.startsWith("/sessions") ||
        normalizedPath.startsWith("/voice"))
    ) {
      const sessionMatch = normalizedPath.match(/^\/sessions\/([^/]+)/);
      const targetSessionId = sessionMatch ? sessionMatch[1] : undefined;
      const tenantId = req.headers.get("X-Tenant-ID") || undefined;

      const rateLimiter = getRateLimiter();
      const rateLimitRes = rateLimiter.checkRateLimit({
        sessionId: targetSessionId,
        tenantId,
      });

      if (!rateLimitRes.allowed) {
        return rateLimiter.create429Response(
          rateLimitRes,
          targetSessionId ? `session ${targetSessionId}` : "requests",
        );
      }
    }

    // Route: /models
    if (normalizedPath === "/models" || normalizedPath === "/models/") {
      return modelsHandler.listModels();
    }

    // Route: /roles
    if (normalizedPath === "/roles" || normalizedPath === "/roles/") {
      return rolesHandler.listRoles();
    }

    // Route: /roles/:id
    const roleMatch = normalizedPath.match(/^\/roles\/([^/]+)$/);
    if (roleMatch && method === "GET") {
      return rolesHandler.getRole(roleMatch[1]);
    }

    // Route: /tools
    if (normalizedPath === "/tools" || normalizedPath === "/tools/") {
      return toolsHandler.listTools();
    }

    // Route: /tools/:name
    const toolMatch = normalizedPath.match(/^\/tools\/([^/]+)$/);
    if (toolMatch && method === "GET") {
      return toolsHandler.getTool(toolMatch[1]);
    }

    // Route: /audit
    if (
      normalizedPath === "/audit/verify" ||
      normalizedPath === "/audit/verify/"
    ) {
      return auditHandler.handleVerifyIntegrity();
    }
    if (normalizedPath.startsWith("/audit")) {
      return auditHandler.handleGetRecords(req);
    }

    // Route: /infra/status
    if (
      normalizedPath === "/infra/status" ||
      normalizedPath === "/infra/status/"
    ) {
      return infraStatusHandler.getInfraStatus(req);
    }

    // Route: /resilience/status
    if (
      normalizedPath === "/resilience/status" ||
      normalizedPath === "/resilience/status/" ||
      normalizedPath === "/resilience" ||
      normalizedPath === "/resilience/"
    ) {
      return resilienceHandler.getStatus();
    }

    // Route: /resilience/breakers/:name/reset
    const resetBreakerMatch = normalizedPath.match(
      /^\/resilience\/breakers\/([^/]+)\/reset$/,
    );
    if (resetBreakerMatch && method === "POST") {
      return resilienceHandler.resetBreaker(resetBreakerMatch[1]);
    }

    // Route: /resilience/breakers/:name/trip
    const tripBreakerMatch = normalizedPath.match(
      /^\/resilience\/breakers\/([^/]+)\/trip$/,
    );
    if (tripBreakerMatch && method === "POST") {
      return resilienceHandler.tripBreaker(tripBreakerMatch[1]);
    }

    // Route: /queue/metrics
    if (
      normalizedPath === "/queue/metrics" ||
      normalizedPath === "/queue/metrics/"
    ) {
      return handler.getQueueMetrics();
    }

    // Route: /queue/jobs
    if (normalizedPath === "/queue/jobs" || normalizedPath === "/queue/jobs/") {
      return handler.listQueueJobs(req);
    }

    // Route: /queue/jobs/:id/retry
    const retryJobMatch = normalizedPath.match(
      /^\/queue\/jobs\/([^/]+)\/retry$/,
    );
    if (retryJobMatch && method === "POST") {
      return handler.retryDeadLetterJob(retryJobMatch[1]);
    }

    if (normalizedPath === "/metrics" || normalizedPath === "/metrics/") {
      const targetSessionId = url.searchParams.get("sessionId") || undefined;
      const { spanCollector } = await import("../observability/otel");
      return new Response(
        JSON.stringify({
          status: "success",
          data: spanCollector.getSystemSummary(targetSessionId),
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }

    if (normalizedPath === "/traces" || normalizedPath === "/traces/") {
      const targetSessionId = url.searchParams.get("sessionId") || undefined;
      const targetTraceId = url.searchParams.get("traceId") || undefined;
      const limit = parseInt(url.searchParams.get("limit") || "100", 10);
      const { spanCollector } = await import("../observability/otel");
      const spans = spanCollector.getSpans({
        sessionId: targetSessionId,
        traceId: targetTraceId,
        limit,
      });
      return new Response(
        JSON.stringify({
          status: "success",
          count: spans.length,
          data: spans,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }

    if (normalizedPath === "/metrics/stream") {
      const targetSessionId = url.searchParams.get("sessionId") || undefined;
      const { spanCollector } = await import("../observability/otel");

      let timer: any;
      const stream = new ReadableStream({
        start(controller) {
          const sendMetrics = () => {
            try {
              const summary = spanCollector.getSystemSummary(targetSessionId);
              const data = `data: ${JSON.stringify(summary)}\n\n`;
              controller.enqueue(new TextEncoder().encode(data));
            } catch {
              // ignore socket write errors on client disconnect
            }
          };

          sendMetrics();
          timer = setInterval(sendMetrics, 1000);
        },
        cancel() {
          if (timer) clearInterval(timer);
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Route: /sessions/:id/stream (Server-Sent Events)
    const streamMatch = normalizedPath.match(/^\/sessions\/([^/]+)\/stream$/);
    if (streamMatch) {
      const sessionId = streamMatch[1];
      return sseHandler.handleStreamRequest(sessionId, req);
    }

    // GET /sessions or POST /sessions
    if (normalizedPath === "/sessions" || normalizedPath === "/sessions/") {
      if (method === "GET") {
        return handler.listSessions(req);
      }
      if (method === "POST") {
        return handler.createSession(req);
      }
    }

    // Route: /sandbox/info
    if (
      normalizedPath === "/sandbox/info" ||
      normalizedPath === "/sandbox/info/"
    ) {
      return guardrailHandler.getSandboxInfo();
    }

    // Route: /sessions/:id/messages
    const messagesMatch = normalizedPath.match(
      /^\/sessions\/([^/]+)\/messages$/,
    );
    if (messagesMatch) {
      const sessionId = messagesMatch[1];
      if (method === "POST") {
        return handler.sendMessage(sessionId, req);
      }
    }

    // Route: /sessions/:id/approval and /sessions/:id/guardrails/approval
    const approvalMatch = normalizedPath.match(
      /^\/sessions\/([^/]+)\/(?:guardrails\/)?approval$/,
    );
    if (approvalMatch) {
      const sessionId = approvalMatch[1];
      if (method === "POST") {
        return guardrailHandler.handleApproval(sessionId, req);
      }
    }

    // Route: /sessions/:id/sandbox
    const sessionSandboxMatch = normalizedPath.match(
      /^\/sessions\/([^/]+)\/sandbox$/,
    );
    if (sessionSandboxMatch) {
      const sessionId = sessionSandboxMatch[1];
      if (method === "GET") {
        return guardrailHandler.getSandboxInfo(sessionId);
      }
    }

    // Route: /sessions/:id/infra-status
    const sessionInfraMatch = normalizedPath.match(
      /^\/sessions\/([^/]+)\/infra-status$/,
    );
    if (sessionInfraMatch) {
      const sessionId = sessionInfraMatch[1];
      if (method === "GET") {
        return infraStatusHandler.getInfraStatus(req, sessionId);
      }
    }

    // Route: /voice/status
    if (
      normalizedPath === "/voice/status" ||
      normalizedPath === "/voice/status/"
    ) {
      return voiceHandler.getGlobalVoiceStatus();
    }

    // Route: /sessions/:id/voice/token
    const voiceTokenMatch = normalizedPath.match(
      /^\/sessions\/([^/]+)\/voice\/token$/,
    );
    if (voiceTokenMatch && method === "POST") {
      return voiceHandler.createToken(voiceTokenMatch[1], req);
    }

    // Route: /sessions/:id/voice/transcribe
    const voiceTranscribeMatch = normalizedPath.match(
      /^\/sessions\/([^/]+)\/voice\/transcribe$/,
    );
    if (voiceTranscribeMatch && method === "POST") {
      return voiceHandler.transcribeAudio(voiceTranscribeMatch[1], req);
    }

    // Route: /sessions/:id/voice/status
    const voiceStatusMatch = normalizedPath.match(
      /^\/sessions\/([^/]+)\/voice\/status$/,
    );
    if (voiceStatusMatch && method === "GET") {
      return voiceHandler.getSessionVoiceStatus(voiceStatusMatch[1]);
    }

    // Route: /sessions/:id
    const sessionMatch = normalizedPath.match(/^\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const sessionId = sessionMatch[1];
      if (method === "GET") {
        return handler.getSession(sessionId);
      }
      if (method === "DELETE") {
        return handler.deleteSession(sessionId);
      }
    }

    // 404 Fallback
    return new Response(
      JSON.stringify({
        status: "error",
        error: {
          code: "NOT_FOUND",
          message: `Endpoint ${method} ${pathname} not found`,
        },
      }),
      {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  };
}

export function startHttpServer(options: HttpServerOptions = {}) {
  const port = options.port ?? Number(process.env.PORT || 4000);
  const hostname = options.hostname ?? process.env.HOST ?? "0.0.0.0";

  let sessionManager = options.sessionManager;
  if (!sessionManager) {
    const localExecutor = new LocalExecutor();
    const dockerExecutor = new DockerExecutor({
      fallbackExecutor: localExecutor,
    });
    const grpcExecutor = new GrpcExecutor({
      fallbackExecutor: dockerExecutor,
    });
    const k8sExecutor = new KubernetesJobExecutor({
      fallbackExecutor: dockerExecutor,
    });

    const executorMode = (
      process.env.CRUCIBLE_EXECUTOR || "docker"
    ).toLowerCase();
    const executor =
      executorMode === "grpc"
        ? grpcExecutor
        : executorMode === "k8s" || executorMode === "kubernetes"
          ? k8sExecutor
          : executorMode === "local"
            ? localExecutor
            : dockerExecutor;
    const tools = new ToolRegistry()
      .register(calculatorTool)
      .register(getCurrentTimeTool)
      .register(createBashTool({ executor }))
      .register(readFileTool);

    const modelEnv = process.env.OPENROUTER_MODEL || "openrouter/free";
    const provider =
      modelEnv === "mock" || process.env.CRUCIBLE_MOCK_PROVIDER === "true"
        ? new MockModelProvider()
        : new OpenRouterProvider({
            defaultModel: modelEnv,
          });

    const sessionRepository =
      process.env.DATABASE_URL || process.env.POSTGRES_URL
        ? new SessionRepository()
        : undefined;
    const runRepository =
      process.env.DATABASE_URL || process.env.POSTGRES_URL
        ? new RunRepository()
        : undefined;
    const redisStore = process.env.REDIS_URL
      ? new RedisSessionStore()
      : undefined;

    sessionManager = new SessionManager({
      defaultProvider: provider,
      defaultTools: tools,
      defaultSystemPrompt:
        "You are Crucible, an advanced AI reasoning assistant with local bash execution and file system tools. Provide direct, helpful answers.",
      sessionRepository,
      runRepository,
      redisStore,
    });

    if (sessionRepository) {
      sessionManager.restoreFromPersistence().catch((err) => {
        logger.warn(
          { err },
          "[Server] Background session restore encountered an error",
        );
      });
    }
  }

  const errorReporter = getErrorReporter();
  errorReporter.attachToSessionManager(sessionManager);

  const sseHandler = new SseStreamHandler(sessionManager);
  const wsGateway = new WebSocketGateway(sessionManager);

  const router = createHttpRouter(sessionManager, sseHandler);

  const server = Bun.serve<WsConnectionData>({
    port,
    hostname,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/ws" || url.pathname === "/api/ws") {
        const sessionId = url.searchParams.get("sessionId") || undefined;
        const success = srv.upgrade(req, {
          data: {
            sessionId,
            subscribedSessions: sessionId ? new Set([sessionId]) : new Set(),
            connectedAt: new Date(),
          },
        });
        if (success) return undefined;
      }
      return router(req, srv);
    },
    websocket: {
      open(ws) {
        wsGateway.handleOpen(ws);
      },
      message(ws, message) {
        wsGateway.handleMessage(ws, message);
      },
      close(ws, code, reason) {
        wsGateway.handleClose(ws, code, reason);
      },
    },
    error(err) {
      errorReporter.captureAgentError(err, { state: "server_unhandled" });
      return new Response(
        JSON.stringify({
          status: "error",
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "An internal server error occurred",
          },
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    },
  });

  console.log(
    `[Crucible Core] HTTP REST & Real-Time Streaming Server listening on http://${hostname}:${server.port}`,
  );
  return server;
}

// Auto-run if executed directly
if (import.meta.main) {
  startHttpServer();
}
