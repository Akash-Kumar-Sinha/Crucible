import { EventEmitter } from "node:events";
import type { SessionManager } from "../session/session-manager";
import type { Session } from "../session/session";
import type { AgentState } from "../agent/state-machine/types";
import { logger } from "./logger";
import { tracer } from "./otel";

export interface AgentErrorContext {
  sessionId?: string;
  tenantId?: string;
  namespace?: string;
  turnId?: number;
  traceId?: string;
  spanId?: string;
  traceparent?: string;
  state?: AgentState | string;
  status?: string;
  toolName?: string;
  model?: string;
  correlationId?: string;
  component?: string;
  alert?: string;
  code?: number;
  reason?: string;
  extra?: Record<string, unknown>;
}

export interface ContainerFailureContext {
  containerId?: string;
  image?: string;
  exitCode?: number;
  oomKilled?: boolean;
  memoryLimitBytes?: number;
  cpuLimit?: number;
  reason:
    | "CONTAINER_OOM_KILLED"
    | "CONTAINER_NON_ZERO_EXIT"
    | "CONTAINER_TIMEOUT"
    | "DOCKER_DAEMON_UNAVAILABLE"
    | string;
  stderr?: string;
  sessionId?: string;
  tenantId?: string;
  namespace?: string;
  toolName?: string;
  extra?: Record<string, unknown>;
}

export interface InfraFailureContext {
  podName?: string;
  jobName?: string;
  namespace?: string;
  tenantId?: string;
  image?: string;
  exitCode?: number;
  oomKilled?: boolean;
  reason:
    | "INFRA_POD_OOM_KILLED"
    | "INFRA_POD_EVICTED"
    | "INFRA_POD_FAILED"
    | "INFRA_SCHEDULING_TIMEOUT"
    | string;
  message?: string;
  sessionId?: string;
  toolName?: string;
  extra?: Record<string, unknown>;
}

export interface Breadcrumb {
  timestamp: string;
  category: string;
  message: string;
  level?: "info" | "warning" | "error";
  data?: Record<string, unknown>;
}

export interface CapturedErrorRecord {
  id: string;
  timestamp: string;
  message: string;
  stack?: string;
  level: "error" | "warning" | "fatal";
  tenantId?: string;
  namespace?: string;
  scopeKey?: string;
  context: AgentErrorContext;
  breadcrumbs: Breadcrumb[];
  containerContext?: ContainerFailureContext;
  infraContext?: InfraFailureContext;
}

export interface ErrorMetrics {
  totalErrors: number;
  errorsInLastMinute: number;
  errorsInLast5Minutes: number;
  errorRatePerMinute: number;
  lastErrorTimestamp?: string;
  recentErrors: CapturedErrorRecord[];
  containerFailuresCount: number;
  infraFailuresCount: number;
}

export interface TenantErrorMetrics extends ErrorMetrics {
  tenantId?: string;
  namespace?: string;
  scopeKey?: string;
}

export interface AlertThresholds {
  maxErrorsPerMinute?: number;
  maxConsecutiveErrors?: number;
  cooldownPeriodMs?: number;
}

export interface AlertPayload {
  severity: "warning" | "critical";
  service: string;
  reason: string;
  metrics: TenantErrorMetrics;
  lastError?: CapturedErrorRecord;
  timestamp: string;
}

export type AlertHandler = (alert: AlertPayload) => Promise<void> | void;

export interface ErrorReporterOptions {
  maxRecentErrors?: number;
  alertThresholds?: AlertThresholds;
  onAlert?: AlertHandler;
  serverName?: string;
}

interface ErrorBucket {
  recentErrors: CapturedErrorRecord[];
  totalErrorsCount: number;
  consecutiveErrorsCount: number;
  containerFailuresCount: number;
  infraFailuresCount: number;
  lastAlertTimestamp: number;
}

export class ErrorReporter extends EventEmitter {
  private serverName: string;
  private maxRecentErrors: number;
  private alertThresholds: AlertThresholds;
  private onAlert?: AlertHandler;

  private readonly globalBucket: ErrorBucket = this.createEmptyBucket();
  private readonly tenantBuckets = new Map<string, ErrorBucket>();
  private breadcrumbs: Breadcrumb[] = [];

  constructor(options: ErrorReporterOptions = {}) {
    super();
    this.serverName = options.serverName || "crucible-orchestrator";
    this.maxRecentErrors = options.maxRecentErrors || 50;
    this.alertThresholds = {
      maxErrorsPerMinute: options.alertThresholds?.maxErrorsPerMinute ?? 5,
      maxConsecutiveErrors: options.alertThresholds?.maxConsecutiveErrors ?? 3,
      cooldownPeriodMs: options.alertThresholds?.cooldownPeriodMs ?? 60_000,
    };
    this.onAlert = options.onAlert;
  }

  addBreadcrumb(breadcrumb: Omit<Breadcrumb, "timestamp">): void {
    const entry: Breadcrumb = {
      ...breadcrumb,
      timestamp: new Date().toISOString(),
    };
    this.breadcrumbs.push(entry);
    if (this.breadcrumbs.length > 20) {
      this.breadcrumbs.shift();
    }
  }

  private createEmptyBucket(): ErrorBucket {
    return {
      recentErrors: [],
      totalErrorsCount: 0,
      consecutiveErrorsCount: 0,
      containerFailuresCount: 0,
      infraFailuresCount: 0,
      lastAlertTimestamp: 0,
    };
  }

  private normalizeScope(scope?: { tenantId?: string; namespace?: string }): {
    tenantId: string;
    namespace: string;
    scopeKey: string;
  } {
    const tenantId = scope?.tenantId?.trim() || "default";
    const namespace =
      scope?.namespace?.trim() || process.env.CRUCIBLE_NAMESPACE || "crucible";

    return {
      tenantId,
      namespace,
      scopeKey: `${tenantId}::${namespace}`,
    };
  }

  private getScopeBucket(scope?: { tenantId?: string; namespace?: string }): {
    bucket: ErrorBucket;
    scopeKey: string;
    tenantId?: string;
    namespace?: string;
  } {
    if (!scope) {
      return {
        bucket: this.globalBucket,
        scopeKey: "global",
      };
    }

    const normalized = this.normalizeScope(scope);
    let bucket = this.tenantBuckets.get(normalized.scopeKey);
    if (!bucket) {
      bucket = this.createEmptyBucket();
      this.tenantBuckets.set(normalized.scopeKey, bucket);
    }

    return {
      bucket,
      scopeKey: normalized.scopeKey,
      tenantId: normalized.tenantId,
      namespace: normalized.namespace,
    };
  }

  private buildMetrics(
    bucket: ErrorBucket,
    scope?: { tenantId?: string; namespace?: string; scopeKey?: string },
  ): TenantErrorMetrics {
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    const fiveMinutesAgo = now - 300_000;

    const errorsInLastMinute = bucket.recentErrors.filter(
      (e) => new Date(e.timestamp).getTime() >= oneMinuteAgo,
    ).length;

    const errorsInLast5Minutes = bucket.recentErrors.filter(
      (e) => new Date(e.timestamp).getTime() >= fiveMinutesAgo,
    ).length;

    const lastError = bucket.recentErrors[bucket.recentErrors.length - 1];

    return {
      totalErrors: bucket.totalErrorsCount,
      errorsInLastMinute,
      errorsInLast5Minutes,
      errorRatePerMinute: errorsInLastMinute,
      lastErrorTimestamp: lastError?.timestamp,
      recentErrors: [...bucket.recentErrors],
      containerFailuresCount: bucket.containerFailuresCount,
      infraFailuresCount: bucket.infraFailuresCount,
      tenantId: scope?.tenantId,
      namespace: scope?.namespace,
      scopeKey: scope?.scopeKey,
    };
  }

  /**
   * Observer Pattern: Subscribe directly to SessionManager event stream
   */
  attachToSessionManager(sessionManager: SessionManager): () => void {
    const onSessionError = (sessionId: string, error: unknown) => {
      const session = sessionManager.get(sessionId);
      this.captureAgentError(error, {
        sessionId,
        tenantId: session?.getTenantId(),
        namespace: session?.getNamespace(),
        state: "error",
      });
    };

    const onSessionStateChange = (sessionId: string, state: AgentState) => {
      this.addBreadcrumb({
        category: "session.state",
        message: `Session ${sessionId} transitioned to ${state}`,
        data: { sessionId, state },
      });

      if (state === "error") {
        const session = sessionManager.get(sessionId);
        const ctx = session?.getContext();
        if (ctx?.error) {
          this.captureAgentError(ctx.error, {
            sessionId,
            tenantId: session?.getTenantId(),
            namespace: session?.getNamespace(),
            state: "error",
            turnId: ctx.stepCount,
          });
        }
      }
    };

    sessionManager.on("sessionError", onSessionError);
    sessionManager.on("sessionStateChange", onSessionStateChange);

    return () => {
      sessionManager.off("sessionError", onSessionError);
      sessionManager.off("sessionStateChange", onSessionStateChange);
    };
  }

  /**
   * Observer Pattern: Subscribe to individual Session instance
   */
  attachToSession(session: Session): () => void {
    const onError = (err: unknown) => {
      this.captureAgentError(err, {
        sessionId: session.id,
        tenantId: session.getTenantId(),
        namespace: session.getNamespace(),
        state: session.getState(),
      });
    };

    const onStateChange = (state: AgentState) => {
      this.addBreadcrumb({
        category: "agent.transition",
        message: `Agent transitioned to ${state}`,
        data: { sessionId: session.id, state },
      });
    };

    session.on("error", onError);
    session.on("stateChange", onStateChange);

    return () => {
      session.off("error", onError);
      session.off("stateChange", onStateChange);
    };
  }

  captureAgentError(error: unknown, context: AgentErrorContext = {}): string {
    const errorId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const timestamp = new Date().toISOString();
    let message = "Unknown error";
    let stack: string | undefined;
    let errInstance: Error | undefined;

    if (error instanceof Error) {
      errInstance = error;
      message = error.message;
      stack = error.stack;
    } else if (typeof error === "string") {
      errInstance = new Error(error);
      message = error;
      stack = errInstance.stack;
    } else if (typeof error === "object" && error !== null) {
      const maybeObj = error as Record<string, unknown>;
      message =
        typeof maybeObj.message === "string"
          ? maybeObj.message
          : JSON.stringify(error);
      errInstance = new Error(message);
      if (typeof maybeObj.stack === "string") {
        stack = maybeObj.stack;
      }
    }

    const activeSpan = tracer.getActiveSpan();
    const scope = this.normalizeScope({
      tenantId: context.tenantId,
      namespace: context.namespace,
    });
    const enrichedContext: AgentErrorContext = {
      traceId: activeSpan?.traceId,
      spanId: activeSpan?.id,
      traceparent: activeSpan?.getTraceparent(),
      ...context,
      tenantId: scope.tenantId,
      namespace: scope.namespace,
    };

    const scoped = this.getScopeBucket(scope);
    const record: CapturedErrorRecord = {
      id: errorId,
      timestamp,
      message,
      stack,
      level: "error",
      tenantId: scope.tenantId,
      namespace: scope.namespace,
      scopeKey: scope.scopeKey,
      context: enrichedContext,
      breadcrumbs: [...this.breadcrumbs],
    };

    this.globalBucket.totalErrorsCount += 1;
    this.globalBucket.consecutiveErrorsCount += 1;
    this.globalBucket.recentErrors.push(record);
    if (this.globalBucket.recentErrors.length > this.maxRecentErrors) {
      this.globalBucket.recentErrors.shift();
    }

    scoped.bucket.totalErrorsCount += 1;
    scoped.bucket.consecutiveErrorsCount += 1;
    scoped.bucket.recentErrors.push(record);
    if (scoped.bucket.recentErrors.length > this.maxRecentErrors) {
      scoped.bucket.recentErrors.shift();
    }

    // Fast structured JSON logging via Pino
    logger.error(
      {
        err: errInstance,
        errorId,
        sessionId: context.sessionId,
        tenantId: scope.tenantId,
        namespace: scope.namespace,
        scopeKey: scope.scopeKey,
        turnId: context.turnId,
        tool: context.toolName,
        agentState: context.state,
        model: context.model,
        correlationId: context.correlationId,
        ...context.extra,
      },
      `[Agent Error] ${message}`,
    );

    this.emit("errorCaptured", record);

    this.evaluateAlertConditions(record, scope).catch(() => {
      // Local alert evaluation error
    });

    return errorId;
  }

  /**
   * Capture container-level failures (non-zero exits, OOM kills, timeout kills)
   */
  captureContainerFailure(info: ContainerFailureContext): string {
    const errorId = `cnt_err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const timestamp = new Date().toISOString();
    const scope = this.normalizeScope({
      tenantId: info.tenantId,
      namespace: info.namespace,
    });
    const message = `Container failure (${info.reason}): Container ${info.containerId || "unknown"} [Image: ${info.image || "unknown"}] exited with code ${info.exitCode ?? "N/A"}${info.oomKilled ? " (OOM Killed)" : ""}`;

    const record: CapturedErrorRecord = {
      id: errorId,
      timestamp,
      message,
      level: info.oomKilled ? "fatal" : "error",
      tenantId: scope.tenantId,
      namespace: scope.namespace,
      scopeKey: scope.scopeKey,
      context: {
        sessionId: info.sessionId,
        tenantId: scope.tenantId,
        namespace: scope.namespace,
        toolName: info.toolName,
        extra: { ...info.extra },
      },
      containerContext: info,
      breadcrumbs: [...this.breadcrumbs],
    };

    const scoped = this.getScopeBucket(scope);

    this.globalBucket.totalErrorsCount += 1;
    this.globalBucket.consecutiveErrorsCount += 1;
    this.globalBucket.containerFailuresCount += 1;
    this.globalBucket.recentErrors.push(record);
    if (this.globalBucket.recentErrors.length > this.maxRecentErrors) {
      this.globalBucket.recentErrors.shift();
    }

    scoped.bucket.totalErrorsCount += 1;
    scoped.bucket.consecutiveErrorsCount += 1;
    scoped.bucket.containerFailuresCount += 1;
    scoped.bucket.recentErrors.push(record);
    if (scoped.bucket.recentErrors.length > this.maxRecentErrors) {
      scoped.bucket.recentErrors.shift();
    }

    // Structured logging with full container telemetry
    logger.error(
      {
        errorId,
        containerId: info.containerId,
        image: info.image,
        exitCode: info.exitCode,
        oomKilled: info.oomKilled,
        memoryLimitBytes: info.memoryLimitBytes,
        cpuLimit: info.cpuLimit,
        reason: info.reason,
        stderr: info.stderr,
        sessionId: info.sessionId,
        tenantId: scope.tenantId,
        namespace: scope.namespace,
        scopeKey: scope.scopeKey,
        toolName: info.toolName,
        ...info.extra,
      },
      `[Container Failure] ${message}`,
    );

    this.emit("containerFailure", record);
    this.emit("errorCaptured", record);

    this.evaluateAlertConditions(record, scope).catch(() => {});

    return errorId;
  }

  /**
   * Capture infrastructure-level failures (Kubernetes Pod OOMKilled, Pod Evicted, scheduling timeout)
   * Distinct from ordinary application-level tool failures.
   */
  captureInfraFailure(info: InfraFailureContext): string {
    const errorId = `inf_err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const timestamp = new Date().toISOString();
    const scope = this.normalizeScope({
      tenantId: info.tenantId,
      namespace: info.namespace,
    });
    const isOOM = info.reason === "INFRA_POD_OOM_KILLED" || info.oomKilled;
    const message = `Infrastructure failure (${info.reason}): Pod ${info.podName || "unknown"} in namespace ${info.namespace || "crucible"} failed. ${info.message || ""}`;

    const record: CapturedErrorRecord = {
      id: errorId,
      timestamp,
      message,
      level: isOOM ? "fatal" : "error",
      tenantId: scope.tenantId,
      namespace: scope.namespace,
      scopeKey: scope.scopeKey,
      context: {
        sessionId: info.sessionId,
        tenantId: scope.tenantId,
        namespace: scope.namespace,
        toolName: info.toolName,
        reason: info.reason,
        extra: { ...info.extra },
      },
      infraContext: info,
      breadcrumbs: [...this.breadcrumbs],
    };

    const scoped = this.getScopeBucket(scope);

    this.globalBucket.totalErrorsCount += 1;
    this.globalBucket.consecutiveErrorsCount += 1;
    this.globalBucket.infraFailuresCount += 1;
    this.globalBucket.recentErrors.push(record);
    if (this.globalBucket.recentErrors.length > this.maxRecentErrors) {
      this.globalBucket.recentErrors.shift();
    }

    scoped.bucket.totalErrorsCount += 1;
    scoped.bucket.consecutiveErrorsCount += 1;
    scoped.bucket.infraFailuresCount += 1;
    scoped.bucket.recentErrors.push(record);
    if (scoped.bucket.recentErrors.length > this.maxRecentErrors) {
      scoped.bucket.recentErrors.shift();
    }

    // Structured logging with full infra failure telemetry
    logger.error(
      {
        errorId,
        podName: info.podName,
        jobName: info.jobName,
        namespace: info.namespace,
        image: info.image,
        exitCode: info.exitCode,
        oomKilled: isOOM,
        reason: info.reason,
        sessionId: info.sessionId,
        tenantId: scope.tenantId,
        scopeKey: scope.scopeKey,
        toolName: info.toolName,
        ...info.extra,
      },
      `[Infrastructure Failure] ${message}`,
    );

    this.emit("infraFailure", record);
    this.emit("errorCaptured", record);

    this.evaluateAlertConditions(record, scope).catch(() => {});

    return errorId;
  }

  getMetrics(scope?: {
    tenantId?: string;
    namespace?: string;
  }): TenantErrorMetrics {
    if (!scope) {
      return this.buildMetrics(this.globalBucket, { scopeKey: "global" });
    }

    const normalized = this.normalizeScope(scope);
    const bucket =
      this.tenantBuckets.get(normalized.scopeKey) || this.createEmptyBucket();
    return this.buildMetrics(bucket, normalized);
  }

  getRecentErrors(scope?: {
    tenantId?: string;
    namespace?: string;
  }): CapturedErrorRecord[] {
    if (!scope) {
      return [...this.globalBucket.recentErrors];
    }

    const normalized = this.normalizeScope(scope);
    return [
      ...(this.tenantBuckets.get(normalized.scopeKey)?.recentErrors || []),
    ];
  }

  resetMetrics(scope?: { tenantId?: string; namespace?: string }): void {
    if (!scope) {
      this.globalBucket.recentErrors = [];
      this.globalBucket.totalErrorsCount = 0;
      this.globalBucket.consecutiveErrorsCount = 0;
      this.globalBucket.containerFailuresCount = 0;
      this.globalBucket.infraFailuresCount = 0;
      this.globalBucket.lastAlertTimestamp = 0;
      this.tenantBuckets.clear();
    } else {
      const normalized = this.normalizeScope(scope);
      const bucket = this.tenantBuckets.get(normalized.scopeKey);
      if (bucket) {
        bucket.recentErrors = [];
        bucket.totalErrorsCount = 0;
        bucket.consecutiveErrorsCount = 0;
        bucket.containerFailuresCount = 0;
        bucket.infraFailuresCount = 0;
        bucket.lastAlertTimestamp = 0;
      }
    }
    this.breadcrumbs = [];
  }

  private async evaluateAlertConditions(
    latestError: CapturedErrorRecord,
    scope: { tenantId: string; namespace: string; scopeKey: string },
  ): Promise<void> {
    const now = Date.now();
    const cooldown = this.alertThresholds.cooldownPeriodMs ?? 60_000;
    const scoped = this.getScopeBucket(scope);
    if (now - scoped.bucket.lastAlertTimestamp < cooldown) {
      return;
    }

    const metrics = this.getMetrics({
      tenantId: scope.tenantId,
      namespace: scope.namespace,
    });
    const maxPerMin = this.alertThresholds.maxErrorsPerMinute ?? 5;
    const maxConsecutive = this.alertThresholds.maxConsecutiveErrors ?? 3;

    let triggerReason: string | null = null;
    if (metrics.errorsInLastMinute >= maxPerMin) {
      triggerReason = `Error rate threshold crossed: ${metrics.errorsInLastMinute} errors/min (max allowed: ${maxPerMin})`;
    } else if (scoped.bucket.consecutiveErrorsCount >= maxConsecutive) {
      triggerReason = `Consecutive error count threshold crossed: ${scoped.bucket.consecutiveErrorsCount} consecutive failures`;
    }

    if (triggerReason) {
      scoped.bucket.lastAlertTimestamp = now;
      const alert: AlertPayload = {
        severity: "critical",
        service: this.serverName,
        reason: `${scope.tenantId}/${scope.namespace}: ${triggerReason}`,
        metrics,
        lastError: latestError,
        timestamp: new Date().toISOString(),
      };

      logger.warn(
        {
          reason: triggerReason,
          metrics,
          lastErrorId: latestError.id,
          tenantId: scope.tenantId,
          namespace: scope.namespace,
          scopeKey: scope.scopeKey,
        },
        `[Crucible Alert] ${triggerReason}`,
      );

      this.emit("alertTriggered", alert);

      if (this.onAlert) {
        await this.onAlert(alert);
      }
    }
  }
}

let globalReporter: ErrorReporter | null = null;

export function initErrorReporter(
  options?: ErrorReporterOptions,
): ErrorReporter {
  globalReporter = new ErrorReporter(options);
  return globalReporter;
}

export function getErrorReporter(): ErrorReporter {
  if (!globalReporter) {
    globalReporter = new ErrorReporter();
  }
  return globalReporter;
}

export function captureAgentError(
  error: unknown,
  context?: AgentErrorContext,
): string {
  return getErrorReporter().captureAgentError(error, context);
}

export function captureContainerFailure(info: ContainerFailureContext): string {
  return getErrorReporter().captureContainerFailure(info);
}

export function captureInfraFailure(info: InfraFailureContext): string {
  return getErrorReporter().captureInfraFailure(info);
}
