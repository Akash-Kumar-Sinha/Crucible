import { EventEmitter } from "node:events";
import type { SessionManager } from "../session/session-manager";
import type { Session } from "../session/session";
import type { AgentState } from "../agent/state-machine/types";
import { logger } from "./logger";
import { tracer } from "./otel";

export interface AgentErrorContext {
  sessionId?: string;
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
  context: AgentErrorContext;
  breadcrumbs: Breadcrumb[];
  containerContext?: ContainerFailureContext;
}

export interface ErrorMetrics {
  totalErrors: number;
  errorsInLastMinute: number;
  errorsInLast5Minutes: number;
  errorRatePerMinute: number;
  lastErrorTimestamp?: string;
  recentErrors: CapturedErrorRecord[];
  containerFailuresCount: number;
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
  metrics: ErrorMetrics;
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

export class ErrorReporter extends EventEmitter {
  private serverName: string;
  private maxRecentErrors: number;
  private alertThresholds: AlertThresholds;
  private onAlert?: AlertHandler;

  private recentErrors: CapturedErrorRecord[] = [];
  private totalErrorsCount = 0;
  private consecutiveErrorsCount = 0;
  private containerFailuresCount = 0;
  private lastAlertTimestamp = 0;
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

  /**
   * Observer Pattern: Subscribe directly to SessionManager event stream
   */
  attachToSessionManager(sessionManager: SessionManager): () => void {
    const onSessionError = (sessionId: string, error: unknown) => {
      this.captureAgentError(error, {
        sessionId,
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
    const enrichedContext: AgentErrorContext = {
      traceId: activeSpan?.traceId,
      spanId: activeSpan?.id,
      traceparent: activeSpan?.getTraceparent(),
      ...context,
    };

    const record: CapturedErrorRecord = {
      id: errorId,
      timestamp,
      message,
      stack,
      level: "error",
      context: enrichedContext,
      breadcrumbs: [...this.breadcrumbs],
    };

    this.totalErrorsCount += 1;
    this.consecutiveErrorsCount += 1;
    this.recentErrors.push(record);
    if (this.recentErrors.length > this.maxRecentErrors) {
      this.recentErrors.shift();
    }

    // Fast structured JSON logging via Pino
    logger.error(
      {
        err: errInstance,
        errorId,
        sessionId: context.sessionId,
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

    this.evaluateAlertConditions(record).catch(() => {
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
    const message = `Container failure (${info.reason}): Container ${info.containerId || "unknown"} [Image: ${info.image || "unknown"}] exited with code ${info.exitCode ?? "N/A"}${info.oomKilled ? " (OOM Killed)" : ""}`;

    const record: CapturedErrorRecord = {
      id: errorId,
      timestamp,
      message,
      level: info.oomKilled ? "fatal" : "error",
      context: {
        sessionId: info.sessionId,
        toolName: info.toolName,
        extra: { ...info.extra },
      },
      containerContext: info,
      breadcrumbs: [...this.breadcrumbs],
    };

    this.totalErrorsCount += 1;
    this.consecutiveErrorsCount += 1;
    this.containerFailuresCount += 1;
    this.recentErrors.push(record);
    if (this.recentErrors.length > this.maxRecentErrors) {
      this.recentErrors.shift();
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
        toolName: info.toolName,
        ...info.extra,
      },
      `[Container Failure] ${message}`,
    );

    this.emit("containerFailure", record);
    this.emit("errorCaptured", record);

    this.evaluateAlertConditions(record).catch(() => {});

    return errorId;
  }

  getMetrics(): ErrorMetrics {
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    const fiveMinutesAgo = now - 300_000;

    const errorsInLastMinute = this.recentErrors.filter(
      (e) => new Date(e.timestamp).getTime() >= oneMinuteAgo,
    ).length;

    const errorsInLast5Minutes = this.recentErrors.filter(
      (e) => new Date(e.timestamp).getTime() >= fiveMinutesAgo,
    ).length;

    const lastError = this.recentErrors[this.recentErrors.length - 1];

    return {
      totalErrors: this.totalErrorsCount,
      errorsInLastMinute,
      errorsInLast5Minutes,
      errorRatePerMinute: errorsInLastMinute,
      lastErrorTimestamp: lastError?.timestamp,
      recentErrors: [...this.recentErrors],
      containerFailuresCount: this.containerFailuresCount,
    };
  }

  getRecentErrors(): CapturedErrorRecord[] {
    return [...this.recentErrors];
  }

  resetMetrics(): void {
    this.recentErrors = [];
    this.totalErrorsCount = 0;
    this.consecutiveErrorsCount = 0;
    this.containerFailuresCount = 0;
    this.breadcrumbs = [];
  }

  private async evaluateAlertConditions(
    latestError: CapturedErrorRecord,
  ): Promise<void> {
    const now = Date.now();
    const cooldown = this.alertThresholds.cooldownPeriodMs ?? 60_000;
    if (now - this.lastAlertTimestamp < cooldown) {
      return;
    }

    const metrics = this.getMetrics();
    const maxPerMin = this.alertThresholds.maxErrorsPerMinute ?? 5;
    const maxConsecutive = this.alertThresholds.maxConsecutiveErrors ?? 3;

    let triggerReason: string | null = null;
    if (metrics.errorsInLastMinute >= maxPerMin) {
      triggerReason = `Error rate threshold crossed: ${metrics.errorsInLastMinute} errors/min (max allowed: ${maxPerMin})`;
    } else if (this.consecutiveErrorsCount >= maxConsecutive) {
      triggerReason = `Consecutive error count threshold crossed: ${this.consecutiveErrorsCount} consecutive failures`;
    }

    if (triggerReason) {
      this.lastAlertTimestamp = now;
      const alert: AlertPayload = {
        severity: "critical",
        service: this.serverName,
        reason: triggerReason,
        metrics,
        lastError: latestError,
        timestamp: new Date().toISOString(),
      };

      logger.warn(
        { reason: triggerReason, metrics, lastErrorId: latestError.id },
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
