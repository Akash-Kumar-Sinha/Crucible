import type { SessionManager } from "../../session/session-manager";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  HttpErrorEnvelope,
  SendMessageRequest,
  SendMessageResponse,
  SessionDetailResponse,
  SessionListResponse,
} from "../types";
import { logger } from "../../observability/logger";
import { getErrorReporter } from "../../observability/error-reporter";

export class SessionRouteHandler {
  constructor(private readonly sessionManager: SessionManager) {}

  private jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  private errorResponse(
    code: string,
    message: string,
    status = 400,
    details?: unknown,
  ): Response {
    const errorBody: HttpErrorEnvelope = {
      status: "error",
      error: { code, message, details },
    };
    return this.jsonResponse(errorBody, status);
  }

  async listSessions(req?: Request): Promise<Response> {
    const t0 = performance.now();
    try {
      let filter: { tenantId?: string; namespace?: string } | undefined;
      if (req) {
        const url = new URL(req.url);
        const tenantId = url.searchParams.get("tenantId") || undefined;
        const namespace = url.searchParams.get("namespace") || undefined;
        if (tenantId || namespace) {
          filter = { tenantId, namespace };
        }
      }
      const sessions = this.sessionManager.list(filter);
      const response: SessionListResponse = {
        sessions,
        total: sessions.length,
      };
      const durationMs = Math.round(performance.now() - t0);
      logger.debug(
        { total: sessions.length, durationMs, filter },
        "Listed active sessions",
      );
      return this.jsonResponse(response, 200);
    } catch (err: any) {
      logger.error({ err }, "Failed to list active sessions");
      return this.errorResponse(
        "LIST_SESSIONS_FAILED",
        err.message || "Failed to retrieve session list",
        500,
      );
    }
  }

  async createSession(req: Request): Promise<Response> {
    const t0 = performance.now();
    let body: CreateSessionRequest = {};

    try {
      const contentType = req.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const text = await req.text();
        if (text && text.trim().length > 0) {
          body = JSON.parse(text);
        }
      }
    } catch (parseErr) {
      logger.warn(
        { err: parseErr },
        "Failed to parse request JSON in createSession, falling back to defaults",
      );
    }

    try {
      const session = this.sessionManager.createSession({
        title: body.title || "New Conversation",
        role: body.role,
        model: body.model,
        tenantId: body.tenantId,
        namespace: body.namespace,
        systemPrompt: body.systemPrompt,
        metadata: body.metadata,
      });

      const meta = session.getMetadata();
      const response: CreateSessionResponse = {
        id: session.id,
        title: meta.title || session.id,
        role: session.getRole(),
        model: session.getModel(),
        tenantId: meta.tenantId,
        namespace: meta.namespace,
        status: session.getStatus(),
        createdAt:
          meta.createdAt instanceof Date
            ? meta.createdAt.getTime()
            : Number(meta.createdAt),
      };

      const durationMs = Math.round(performance.now() - t0);
      logger.info(
        {
          sessionId: session.id,
          title: response.title,
          role: response.role,
          model: response.model,
          tenantId: response.tenantId,
          namespace: response.namespace,
          durationMs,
        },
        "Created new session successfully",
      );

      return this.jsonResponse(response, 201);
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - t0);
      logger.error(
        { err, durationMs, body },
        "Failed to create session in SessionManager",
      );
      getErrorReporter().captureAgentError(err, {
        state: "session_creation_failed",
        role: body.role,
        tenantId: body.tenantId,
        extra: { body },
      });

      return this.errorResponse(
        "SESSION_CREATION_FAILED",
        err.message || "Failed to initialize new session",
        500,
        { error: String(err) },
      );
    }
  }

  async getSession(sessionId: string): Promise<Response> {
    const t0 = performance.now();
    const session = this.sessionManager.get(sessionId);
    if (!session) {
      logger.warn({ sessionId }, "Attempted to get non-existent session");
      return this.errorResponse(
        "SESSION_NOT_FOUND",
        `Session '${sessionId}' was not found.`,
        404,
        { sessionId },
      );
    }

    const metadata = session.getMetadata();
    const createdAtMs =
      metadata.createdAt instanceof Date
        ? metadata.createdAt.getTime()
        : Number(metadata.createdAt);
    const updatedAtMs =
      metadata.updatedAt instanceof Date
        ? metadata.updatedAt.getTime()
        : Number(metadata.updatedAt);

    const response: SessionDetailResponse = {
      id: session.id,
      title: metadata.title || session.id,
      role: session.getRole(),
      model: session.getModel(),
      tenantId: metadata.tenantId,
      namespace: metadata.namespace,
      status: session.getStatus(),
      createdAt: createdAtMs,
      metadata: {
        title: metadata.title || session.id,
        role: session.getRole(),
        model: session.getModel(),
        tenantId: metadata.tenantId,
        namespace: metadata.namespace,
        createdAt: createdAtMs,
        turnCount: metadata.turnCount,
        updatedAt: updatedAtMs,
        customMetadata: metadata.customMetadata,
      },
      stepCount: session.getContext().stepCount,
      messages: session.getMessages(),
      lastSteps: session.getHistory(),
    };

    const durationMs = Math.round(performance.now() - t0);
    logger.debug({ sessionId, durationMs }, "Retrieved session details");
    return this.jsonResponse(response, 200);
  }

  async sendMessage(sessionId: string, req: Request): Promise<Response> {
    const t0 = performance.now();
    const session = this.sessionManager.get(sessionId);
    if (!session) {
      logger.warn({ sessionId }, "Cannot send message to non-existent session");
      return this.errorResponse(
        "SESSION_NOT_FOUND",
        `Session '${sessionId}' was not found.`,
        404,
        { sessionId },
      );
    }

    let body: SendMessageRequest;
    try {
      body = await req.json();
    } catch (parseErr) {
      logger.warn(
        { sessionId, err: parseErr },
        "Invalid JSON in sendMessage request",
      );
      return this.errorResponse(
        "INVALID_JSON",
        "Request body must be valid JSON.",
        400,
      );
    }

    if (!body.message || typeof body.message !== "string") {
      return this.errorResponse(
        "INVALID_PARAMETERS",
        "Field 'message' is required and must be a non-empty string.",
        400,
      );
    }

    try {
      logger.info(
        {
          sessionId,
          messageLength: body.message.length,
          async: (body as any).async,
        },
        "Dispatching user prompt to agent loop via job queue",
      );

      if ((body as any).async === true) {
        const job = await this.sessionManager.enqueueJob({
          sessionId: session.id,
          type: "session_run",
          tenantId: session.getTenantId(),
          namespace: session.getNamespace(),
          payload: { prompt: body.message },
        });
        session.queue(job.id);
        return this.jsonResponse(
          {
            status: "queued",
            jobId: job.id,
            sessionId: session.id,
            title: session.title || session.id,
          },
          202,
        );
      }

      const result = await this.sessionManager.dispatch(
        session.id,
        body.message,
      );
      const durationMs = Math.round(performance.now() - t0);

      const response: SendMessageResponse = {
        sessionId: session.id,
        title: session.title || session.id,
        status: session.getStatus(),
        response: result.finalResponse || "",
        turns: session.getMetadata().turnCount,
        steps: session.getContext().stepCount,
        messages: session.getMessages(),
      };

      logger.info(
        {
          sessionId,
          durationMs,
          turns: response.turns,
          status: response.status,
        },
        "Finished processing user message",
      );
      return this.jsonResponse(response, 200);
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - t0);
      logger.error(
        { sessionId, err, durationMs },
        "Agent loop failed while processing user message",
      );
      getErrorReporter().captureAgentError(err, {
        sessionId,
        state: "message_processing_failed",
        tenantId: session.getTenantId(),
        namespace: session.getNamespace(),
      });

      return this.errorResponse(
        "EXECUTION_FAILED",
        err.message || "Failed to process message in session",
        500,
        { error: String(err) },
      );
    }
  }

  async sendInterSessionMessage(
    sessionId: string,
    req: Request,
  ): Promise<Response> {
    const t0 = performance.now();
    const session = this.sessionManager.get(sessionId);
    if (!session) {
      return this.errorResponse(
        "SESSION_NOT_FOUND",
        `Source session '${sessionId}' was not found.`,
        404,
        { sessionId },
      );
    }

    try {
      const body = await req.json();
      if (!body.targetSessionId) {
        return this.errorResponse(
          "INVALID_TARGET_SESSION",
          "A valid 'targetSessionId' must be specified in the request body.",
          400,
        );
      }

      const result = await session.sendToSession(body.targetSessionId, {
        content: body.content,
        task: body.task,
        data: body.data,
        type: body.type,
        correlationId: body.correlationId,
      });

      const durationMs = Math.round(performance.now() - t0);
      logger.info(
        {
          sourceSessionId: sessionId,
          targetSessionId: body.targetSessionId,
          delivered: result.delivered,
          durationMs,
        },
        "Inter-session message publication evaluated",
      );

      return this.jsonResponse(
        {
          status: result.delivered ? "success" : "undeliverable",
          data: result,
        },
        result.delivered ? 200 : 422,
      );
    } catch (err: any) {
      return this.errorResponse(
        "MESSAGE_PUBLISH_FAILED",
        err.message || "Failed to publish inter-session message",
        400,
        { error: String(err) },
      );
    }
  }

  async approveAction(sessionId: string, req: Request): Promise<Response> {
    const t0 = performance.now();
    const session = this.sessionManager.get(sessionId);
    if (!session) {
      logger.warn(
        { sessionId },
        "Cannot submit approval for non-existent session",
      );
      return this.errorResponse(
        "SESSION_NOT_FOUND",
        `Session '${sessionId}' was not found.`,
        404,
        { sessionId },
      );
    }

    let body: {
      approved?: boolean;
      reason?: string;
      toolCallId?: string;
      resume?: boolean;
    };

    try {
      body = await req.json();
    } catch {
      return this.errorResponse(
        "INVALID_JSON",
        "Request body must be valid JSON.",
        400,
      );
    }

    try {
      const isApproved = body.approved !== false;
      let nextState;
      if (isApproved) {
        nextState = session.approve(body.toolCallId);
      } else {
        nextState = session.reject(body.reason, body.toolCallId);
      }

      if (body.resume !== false) {
        session.resume().catch((err) => {
          logger.error(
            { err, sessionId },
            "[Session] Failed to resume execution after human decision",
          );
        });
      }

      const durationMs = Math.round(performance.now() - t0);
      return this.jsonResponse(
        {
          sessionId,
          action: isApproved ? "approved" : "rejected",
          state: nextState,
          status: session.getStatus(),
          durationMs,
        },
        200,
      );
    } catch (err: any) {
      getErrorReporter().captureAgentError(err, {
        sessionId,
        state: "approval_failed",
        tenantId: session.getTenantId(),
        namespace: session.getNamespace(),
      });
      return this.errorResponse(
        "APPROVAL_FAILED",
        err.message || "Failed to process human approval decision",
        400,
      );
    }
  }

  async deleteSession(sessionId: string): Promise<Response> {
    const t0 = performance.now();
    const deleted = this.sessionManager.delete(sessionId);
    if (!deleted) {
      logger.warn({ sessionId }, "Cannot delete non-existent session");
      return this.errorResponse(
        "SESSION_NOT_FOUND",
        `Session '${sessionId}' was not found.`,
        404,
        { sessionId },
      );
    }

    const durationMs = Math.round(performance.now() - t0);
    logger.info({ sessionId, durationMs }, "Deleted session successfully");
    return this.jsonResponse({ success: true, id: sessionId }, 200);
  }

  async getQueueMetrics(): Promise<Response> {
    try {
      const metrics = this.sessionManager.getQueueMetrics();
      return this.jsonResponse({ status: "success", data: metrics }, 200);
    } catch (err: any) {
      return this.errorResponse(
        "QUEUE_METRICS_FAILED",
        err.message || "Failed to retrieve queue metrics",
        500,
      );
    }
  }

  async listQueueJobs(req?: Request): Promise<Response> {
    try {
      let filter: any = {};
      if (req) {
        const url = new URL(req.url);
        const status = url.searchParams.get("status") || undefined;
        const sessionId = url.searchParams.get("sessionId") || undefined;
        const tenantId = url.searchParams.get("tenantId") || undefined;
        const namespace = url.searchParams.get("namespace") || undefined;
        const limit = parseInt(url.searchParams.get("limit") || "100", 10);
        filter = { status, sessionId, tenantId, namespace, limit };
      }
      const jobs = await this.sessionManager.getJobScheduler().listJobs(filter);
      return this.jsonResponse(
        { status: "success", count: jobs.length, data: jobs },
        200,
      );
    } catch (err: any) {
      return this.errorResponse(
        "LIST_QUEUE_JOBS_FAILED",
        err.message || "Failed to list queue jobs",
        500,
      );
    }
  }

  async retryDeadLetterJob(jobId: string): Promise<Response> {
    try {
      const job = await this.sessionManager
        .getJobScheduler()
        .retryDeadLetterJob(jobId);
      if (!job) {
        return this.errorResponse(
          "JOB_NOT_FOUND",
          `Dead-letter job '${jobId}' was not found in DLQ.`,
          404,
          { jobId },
        );
      }
      return this.jsonResponse(
        { status: "success", message: "Job re-queued successfully", data: job },
        200,
      );
    } catch (err: any) {
      return this.errorResponse(
        "RETRY_JOB_FAILED",
        err.message || "Failed to retry dead-letter job",
        500,
      );
    }
  }
}
