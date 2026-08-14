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

  async listSessions(): Promise<Response> {
    const t0 = performance.now();
    try {
      const sessions = this.sessionManager.list();
      const response: SessionListResponse = {
        sessions,
        total: sessions.length,
      };
      const durationMs = Math.round(performance.now() - t0);
      logger.debug(
        { total: sessions.length, durationMs },
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
        systemPrompt: body.systemPrompt,
        metadata: body.metadata,
      });

      const meta = session.getMetadata();
      const response: CreateSessionResponse = {
        id: session.id,
        title: meta.title || session.id,
        status: session.getStatus(),
        createdAt:
          meta.createdAt instanceof Date
            ? meta.createdAt.getTime()
            : Number(meta.createdAt),
      };

      const durationMs = Math.round(performance.now() - t0);
      logger.info(
        { sessionId: session.id, title: response.title, durationMs },
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
      status: session.getStatus(),
      createdAt: createdAtMs,
      metadata: {
        title: metadata.title || session.id,
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
        { sessionId, messageLength: body.message.length },
        "Dispatching user prompt to agent loop",
      );
      const result = await session.prompt(body.message);
      const durationMs = Math.round(performance.now() - t0);

      const response: SendMessageResponse = {
        sessionId: session.id,
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
      });

      return this.errorResponse(
        "EXECUTION_FAILED",
        err.message || "Failed to process message in session",
        500,
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
    } = {};

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
}
