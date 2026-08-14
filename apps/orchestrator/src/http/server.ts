import { SessionManager } from "../session/session-manager";
import { ToolRegistry } from "../tools/registry";
import {
  calculatorTool,
  getCurrentTimeTool,
  createBashTool,
  readFileTool,
} from "../tools/builtin";
import { OpenRouterProvider, MockModelProvider } from "../provider";
import { LocalExecutor } from "../execution/local-executor";
import { SessionRouteHandler } from "./routes/sessions";
import {
  handleHealthzRequest,
  handleReadyzRequest,
  performLivenessCheck,
} from "../observability/health";
import { getErrorReporter } from "../observability/error-reporter";

export interface HttpServerOptions {
  port?: number;
  hostname?: string;
  sessionManager?: SessionManager;
}

export function createHttpRouter(sessionManager: SessionManager) {
  const handler = new SessionRouteHandler(sessionManager);

  return async (req: Request): Promise<Response> => {
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

    // Liveness probe (/healthz or /livez)
    if (
      pathname === "/healthz" ||
      pathname === "/livez" ||
      pathname === "/api/healthz" ||
      pathname === "/api/livez"
    ) {
      return handleHealthzRequest();
    }

    // Readiness probe (/readyz)
    if (pathname === "/readyz" || pathname === "/api/readyz") {
      return handleReadyzRequest();
    }

    // General health check
    if (pathname === "/health" || pathname === "/api/health") {
      const liveness = performLivenessCheck();
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "crucible-orchestrator",
          uptime: liveness.uptime,
          timestamp: liveness.timestamp,
          system: liveness.system,
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
  const port = options.port ?? 4000;
  const hostname = options.hostname ?? "0.0.0.0";

  let sessionManager = options.sessionManager;
  if (!sessionManager) {
    const executor = new LocalExecutor();
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

    sessionManager = new SessionManager({
      defaultProvider: provider,
      defaultTools: tools,
      defaultSystemPrompt:
        "You are Crucible, an advanced AI reasoning assistant with local bash execution and file system tools. Provide direct, helpful answers.",
    });
  }

  const errorReporter = getErrorReporter();
  errorReporter.attachToSessionManager(sessionManager);

  const router = createHttpRouter(sessionManager);

  const server = Bun.serve({
    port,
    hostname,
    fetch: router,
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
    `[Crucible Core] HTTP REST Server listening on http://${hostname}:${server.port}`,
  );
  return server;
}

// Auto-run if executed directly
if (import.meta.main) {
  startHttpServer();
}
