import { describe, it, expect, beforeEach } from "bun:test";
import {
  ErrorReporter,
  initErrorReporter,
  captureAgentError,
} from "./error-reporter";
import {
  logger,
  createSessionLogger,
  createTurnLogger,
  createToolLogger,
} from "./logger";
import {
  performLivenessCheck,
  performReadinessCheck,
  handleHealthzRequest,
  handleReadyzRequest,
} from "./health";
import { SessionManager } from "../session/session-manager";
import { Session } from "../session/session";
import { LocalExecutor } from "../execution/local-executor";
import { createHttpRouter } from "../http/server";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../provider/provider.interface";

class MockProvider implements ModelProvider {
  readonly name = "mock";
  readonly defaultModel = "mock-model";

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const lastMsg = request.messages[request.messages.length - 1];
    if (lastMsg.content === "fail-please") {
      throw new Error("Simulated provider failure");
    }
    return {
      content: "All good!",
      finishReason: "stop",
    };
  }
}

describe("Structured Logging with Pino", () => {
  it("should provide root logger and create contextual child loggers", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");

    const sessionLog = createSessionLogger("sess_log_123");
    expect(sessionLog).toBeDefined();
    expect(sessionLog.bindings().sessionId).toBe("sess_log_123");

    const turnLog = createTurnLogger("sess_log_123", 2);
    expect(turnLog.bindings().sessionId).toBe("sess_log_123");
    expect(turnLog.bindings().turnId).toBe(2);

    const toolLog = createToolLogger(
      "sess_log_123",
      2,
      "bash_exec",
      "call_calc_1",
    );
    expect(toolLog.bindings().sessionId).toBe("sess_log_123");
    expect(toolLog.bindings().tool).toBe("bash_exec");
    expect(toolLog.bindings().callId).toBe("call_calc_1");
  });
});

describe("Observability & Centralized Error Reporter", () => {
  let reporter: ErrorReporter;

  beforeEach(() => {
    reporter = new ErrorReporter({
      alertThresholds: {
        maxErrorsPerMinute: 3,
        maxConsecutiveErrors: 2,
        cooldownPeriodMs: 100,
      },
    });
  });

  it("should capture errors with enriched context and metadata", () => {
    const errId = reporter.captureAgentError(
      new Error("Test runtime failure"),
      {
        sessionId: "sess_123",
        state: "awaiting_model",
        toolName: "bash_exec",
        model: "openrouter/free",
        correlationId: "corr_999",
      },
    );

    expect(errId).toBeString();
    expect(errId.startsWith("err_")).toBeTrue();

    const metrics = reporter.getMetrics();
    expect(metrics.totalErrors).toBe(1);
    expect(metrics.errorsInLastMinute).toBe(1);
    expect(metrics.recentErrors.length).toBe(1);

    const record = metrics.recentErrors[0];
    expect(record.message).toBe("Test runtime failure");
    expect(record.context.sessionId).toBe("sess_123");
    expect(record.context.state).toBe("awaiting_model");
    expect(record.context.toolName).toBe("bash_exec");
    expect(record.context.model).toBe("openrouter/free");
    expect(record.context.correlationId).toBe("corr_999");
  });

  it("should record and manage breadcrumbs", () => {
    reporter.addBreadcrumb({
      category: "navigation",
      message: "User navigated to session view",
    });
    reporter.addBreadcrumb({
      category: "tool",
      message: "Invoking calculator tool",
      data: { expression: "2+2" },
    });

    reporter.captureAgentError(new Error("Calculation timeout"));

    const metrics = reporter.getMetrics();
    const record = metrics.recentErrors[0];
    expect(record.breadcrumbs.length).toBe(2);
    expect(record.breadcrumbs[0].category).toBe("navigation");
    expect(record.breadcrumbs[1].category).toBe("tool");
  });

  it("should subscribe to SessionManager events via Observer Pattern", () => {
    const manager = new SessionManager({
      defaultProvider: new MockProvider(),
    });

    const unsubscribe = reporter.attachToSessionManager(manager);

    // Simulate sessionError event
    manager.emit(
      "sessionError",
      "sess_abc",
      new Error("Tool execution failed"),
    );

    const metrics = reporter.getMetrics();
    expect(metrics.totalErrors).toBe(1);
    expect(metrics.recentErrors[0].context.sessionId).toBe("sess_abc");
    expect(metrics.recentErrors[0].message).toBe("Tool execution failed");

    unsubscribe();
  });

  it("should subscribe to individual Session actor lifecycle events", async () => {
    const session = new Session({
      sessionId: "sess_xyz",
      provider: new MockProvider(),
    });

    const unsubscribe = reporter.attachToSession(session);

    try {
      await session.prompt("fail-please");
    } catch {
      // Expected failure
    }

    const metrics = reporter.getMetrics();
    expect(metrics.totalErrors).toBeGreaterThanOrEqual(1);
    expect(metrics.recentErrors[0].context.sessionId).toBe("sess_xyz");

    unsubscribe();
    session.dispose();
  });

  it("should trigger alert handler when error thresholds are crossed", async () => {
    let alertTriggered = false;
    let alertReason = "";

    const alertReporter = new ErrorReporter({
      alertThresholds: {
        maxErrorsPerMinute: 2,
        maxConsecutiveErrors: 2,
        cooldownPeriodMs: 0,
      },
      onAlert: (alert) => {
        alertTriggered = true;
        alertReason = alert.reason;
      },
    });

    alertReporter.captureAgentError(new Error("Error 1"));
    alertReporter.captureAgentError(new Error("Error 2"));

    // Allow async alert evaluation tick
    await new Promise((r) => setTimeout(r, 10));

    expect(alertTriggered).toBeTrue();
    expect(alertReason).toContain("threshold crossed");
  });
});

describe("Health Check API Pattern", () => {
  it("should perform liveness check and report process telemetry", () => {
    const liveness = performLivenessCheck();

    expect(liveness.status).toBe("healthy");
    expect(liveness.service).toBe("crucible-orchestrator");
    expect(liveness.version).toBe("0.1.0");
    expect(liveness.uptime).toBeGreaterThanOrEqual(0);
    expect(liveness.system).toBeDefined();
    expect(liveness.system?.memoryMb.rss).toBeGreaterThan(0);
    expect(liveness.system?.pid).toBe(process.pid);
  });

  it("should perform readiness check with healthy dependencies", async () => {
    const executor = new LocalExecutor();
    const result = await performReadinessCheck({
      executor,
      checkOpenRouter: async () => true,
      checkExecutor: async () => true,
      checkDisk: async () => true,
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.status).toBe("healthy");
    expect(result.body.checks).toBeDefined();
    expect(result.body.checks?.["orchestrator_loop"].status).toBe("ok");
    expect(result.body.checks?.["openrouter_gateway"].status).toBe("ok");
    expect(result.body.checks?.["execution_engine"].status).toBe("ok");
    expect(result.body.checks?.["docker_daemon"]).toBeDefined();
    expect(result.body.checks?.["disk_workspace"].status).toBe("ok");
  });

  it("should report 503 degraded status when downstream dependency fails", async () => {
    const result = await performReadinessCheck({
      checkOpenRouter: async () => false,
      checkExecutor: async () => true,
      checkDisk: async () => true,
    });

    expect(result.statusCode).toBe(503);
    expect(result.body.status).toBe("degraded");
    expect(result.body.checks?.["openrouter_gateway"].status).toBe("degraded");
  });

  it("should respond to HTTP probes (/healthz, /livez, /readyz) in router", async () => {
    const sessionManager = new SessionManager({
      defaultProvider: new MockProvider(),
    });
    const router = createHttpRouter(sessionManager);

    // Liveness /healthz
    const resHealthz = await router(
      new Request("http://localhost:4000/healthz"),
    );
    expect(resHealthz.status).toBe(200);
    const bodyHealthz = await resHealthz.json();
    expect(bodyHealthz.status).toBe("healthy");
    expect(bodyHealthz.service).toBe("crucible-orchestrator");

    // Liveness /livez
    const resLivez = await router(new Request("http://localhost:4000/livez"));
    expect(resLivez.status).toBe(200);

    // Readiness /readyz
    const resReadyz = await router(new Request("http://localhost:4000/readyz"));
    expect([200, 503]).toContain(resReadyz.status);

    // General /health
    const resHealth = await router(new Request("http://localhost:4000/health"));
    expect(resHealth.status).toBe(200);
    const bodyHealth = await resHealth.json();
    expect(bodyHealth.status).toBe("ok");
  });
});
