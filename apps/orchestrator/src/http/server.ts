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
import { LocalExecutor, DockerExecutor, GrpcExecutor } from "../execution";
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
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
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

    // General health check (includes streaming metrics)
    if (pathname === "/health" || pathname === "/api/health") {
      const liveness = performLivenessCheck();
      const sseMetrics = sseHandler.getMetrics();
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
        return handler.listSessions();
      }
      if (method === "POST") {
        return handler.createSession(req);
      }
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

    const executorMode = process.env.CRUCIBLE_EXECUTOR || "docker";
    const executor =
      executorMode === "grpc"
        ? grpcExecutor
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
