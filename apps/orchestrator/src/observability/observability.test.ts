import { describe, it, expect, beforeEach } from "bun:test";
import { ErrorReporter } from "./error-reporter";
import {
  logger,
  createSessionLogger,
  createTurnLogger,
  createToolLogger,
} from "./logger";
import { performLivenessCheck, performReadinessCheck } from "./health";
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

  it("should isolate error tracking and alert thresholds per tenant and namespace", async () => {
    const alerts: string[] = [];

    const tenantReporter = new ErrorReporter({
      alertThresholds: {
        maxErrorsPerMinute: 2,
        maxConsecutiveErrors: 2,
        cooldownPeriodMs: 0,
      },
      onAlert: (alert) => {
        alerts.push(alert.reason);
      },
    });

    // Custom threshold for tenant-beta
    tenantReporter.setTenantAlertThresholds(
      { tenantId: "tenant-beta", namespace: "crucible-beta" },
      { maxErrorsPerMinute: 10, maxConsecutiveErrors: 10 },
    );

    // Fire 2 errors for noisy tenant-alpha
    tenantReporter.captureAgentError(new Error("Alpha error 1"), {
      tenantId: "tenant-alpha",
      namespace: "crucible-alpha",
    });
    tenantReporter.captureAgentError(new Error("Alpha error 2"), {
      tenantId: "tenant-alpha",
      namespace: "crucible-alpha",
    });

    // Fire 1 error for quiet tenant-beta
    tenantReporter.captureAgentError(new Error("Beta error 1"), {
      tenantId: "tenant-beta",
      namespace: "crucible-beta",
    });

    await new Promise((r) => setTimeout(r, 15));

    // Verify tenant-alpha metrics
    const alphaMetrics = tenantReporter.getMetrics({
      tenantId: "tenant-alpha",
      namespace: "crucible-alpha",
    });
    expect(alphaMetrics.totalErrors).toBe(2);

    // Verify tenant-beta metrics
    const betaMetrics = tenantReporter.getMetrics({
      tenantId: "tenant-beta",
      namespace: "crucible-beta",
    });
    expect(betaMetrics.totalErrors).toBe(1);

    // Verify quiet tenant-gamma metrics
    const gammaMetrics = tenantReporter.getMetrics({
      tenantId: "tenant-gamma",
      namespace: "crucible-gamma",
    });
    expect(gammaMetrics.totalErrors).toBe(0);

    // Verify alerts fired ONLY for tenant-alpha (and not tenant-beta)
    expect(alerts.length).toBe(1);
    expect(alerts[0]).toContain("tenant-alpha");
    expect(alerts[0]).not.toContain("tenant-beta");

    const allTenantMetrics = tenantReporter.listAllTenantMetrics();
    expect(allTenantMetrics.length).toBe(2);
  });

  it("should capture container-level failure events with container context", () => {
    const errId = reporter.captureContainerFailure({
      containerId: "cnt_abc_123",
      image: "node:20-alpine",
      exitCode: 137,
      oomKilled: true,
      memoryLimitBytes: 512 * 1024 * 1024,
      reason: "CONTAINER_OOM_KILLED",
      sessionId: "sess_cont_1",
      toolName: "bash_exec",
    });

    expect(errId).toBeString();
    expect(errId.startsWith("cnt_err_")).toBeTrue();

    const metrics = reporter.getMetrics();
    expect(metrics.totalErrors).toBe(1);
    expect(metrics.containerFailuresCount).toBe(1);

    const record = metrics.recentErrors[0];
    expect(record.level).toBe("fatal");
    expect(record.containerContext).toBeDefined();
    expect(record.containerContext?.containerId).toBe("cnt_abc_123");
    expect(record.containerContext?.exitCode).toBe(137);
    expect(record.containerContext?.oomKilled).toBeTrue();
  });

  it("should capture infrastructure-level failures (Pod OOMKilled/Evicted) distinct from tool errors", () => {
    const errId = reporter.captureInfraFailure({
      podName: "crucible-job-sess1-abc123",
      jobName: "crucible-job-sess1",
      namespace: "crucible",
      image: "crucible-sandbox:latest",
      exitCode: 137,
      oomKilled: true,
      reason: "INFRA_POD_OOM_KILLED",
      sessionId: "sess_k8s_1",
      toolName: "bash_exec",
    });

    expect(errId).toBeString();
    expect(errId.startsWith("inf_err_")).toBeTrue();

    const metrics = reporter.getMetrics();
    expect(metrics.totalErrors).toBe(1);
    expect(metrics.infraFailuresCount).toBe(1);

    const record = metrics.recentErrors[0];
    expect(record.level).toBe("fatal");
    expect(record.infraContext).toBeDefined();
    expect(record.infraContext?.podName).toBe("crucible-job-sess1-abc123");
    expect(record.infraContext?.reason).toBe("INFRA_POD_OOM_KILLED");
    expect(record.message).toContain(
      "Infrastructure failure (INFRA_POD_OOM_KILLED)",
    );
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
      checkPostgres: async () => ({ ok: true, latencyMs: 1 }),
      checkRedis: async () => ({ ok: true, latencyMs: 1 }),
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.status).toBe("healthy");
    expect(result.body.checks).toBeDefined();
    expect(result.body.checks?.["orchestrator_loop"].status).toBe("ok");
    expect(result.body.checks?.["openrouter_gateway"].status).toBe("ok");
    expect(result.body.checks?.["execution_engine"].status).toBe("ok");
    expect(result.body.checks?.["docker_daemon"]).toBeDefined();
    expect(result.body.checks?.["rust_grpc_executor"]).toBeDefined();
    expect(result.body.checks?.["disk_workspace"].status).toBe("ok");
    expect(result.body.checks?.["job_queue"]).toBeDefined();
    expect(result.body.checks?.["job_queue"].status).toBe("ok");
  });

  it("should probe kubernetes cluster API when configured", async () => {
    const result = await performReadinessCheck({
      checkKubernetes: async () => true,
      checkOpenRouter: async () => true,
      checkExecutor: async () => true,
      checkDisk: async () => true,
      checkPostgres: async () => ({ ok: true, latencyMs: 1 }),
      checkRedis: async () => ({ ok: true, latencyMs: 1 }),
    });

    expect(result.body.checks?.["kubernetes_cluster"]).toBeDefined();
    expect(result.body.checks?.["kubernetes_cluster"].status).toBe("ok");
    expect(result.body.checks?.["kubernetes_cluster"].message).toBe(
      "Kubernetes API cluster reachable",
    );
  });

  it("should report 503 degraded status when downstream dependency fails", async () => {
    const result = await performReadinessCheck({
      checkOpenRouter: async () => false,
      checkExecutor: async () => true,
      checkDisk: async () => true,
      checkPostgres: async () => ({ ok: true, latencyMs: 1 }),
      checkRedis: async () => ({ ok: true, latencyMs: 1 }),
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
