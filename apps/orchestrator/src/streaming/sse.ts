import type { SessionManager } from "../session/session-manager";
import { getErrorReporter } from "../observability/error-reporter";
import type { AgentMessage, ToolCall, ToolResult } from "../schema/envelope";

export interface SseStreamMetrics {
  activeSseConnections: number;
  totalSseConnectionsOpened: number;
  totalSseConnectionsClosed: number;
  droppedSseConnections: number;
  droppedPerSession: Record<string, number>;
}

export interface StreamEventPayload {
  type:
    | "token"
    | "thought"
    | "tool_start"
    | "tool_stdout"
    | "tool_stderr"
    | "tool_result"
    | "state_change"
    | "status_change"
    | "message"
    | "done"
    | "error"
    | "heartbeat";
  sessionId: string;
  timestamp: string;
  data: unknown;
}

export class SseStreamHandler {
  private sessionManager: SessionManager;
  private activeStreams: Map<string, Set<ReadableStreamDefaultController>> =
    new Map();
  private metrics: SseStreamMetrics = {
    activeSseConnections: 0,
    totalSseConnectionsOpened: 0,
    totalSseConnectionsClosed: 0,
    droppedSseConnections: 0,
    droppedPerSession: {},
  };

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Returns current active SSE streaming health metrics.
   */
  getMetrics(): SseStreamMetrics {
    return {
      ...this.metrics,
      activeSseConnections: this.getActiveCount(),
      droppedPerSession: { ...this.metrics.droppedPerSession },
    };
  }

  private getActiveCount(): number {
    let count = 0;
    for (const controllers of this.activeStreams.values()) {
      count += controllers.size;
    }
    return count;
  }

  /**
   * Handles an incoming SSE connection request for a specific session ID.
   */
  handleStreamRequest(sessionId: string, req: Request): Response {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      return new Response(
        JSON.stringify({
          status: "error",
          error: {
            code: "SESSION_NOT_FOUND",
            message: `Session '${sessionId}' not found for live stream subscription`,
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
    }

    const encoder = new TextEncoder();
    let controllerRef: ReadableStreamDefaultController | null = null;
    let heartbeatInterval: Timer | null = null;
    let isClosed = false;

    this.metrics.totalSseConnectionsOpened += 1;

    const stream = new ReadableStream({
      start: (controller) => {
        controllerRef = controller;
        if (!this.activeStreams.has(sessionId)) {
          this.activeStreams.set(sessionId, new Set());
        }
        this.activeStreams.get(sessionId)!.add(controller);
        this.metrics.activeSseConnections = this.getActiveCount();

        // Send initial connected frame
        const initialPayload: StreamEventPayload = {
          type: "status_change",
          sessionId,
          timestamp: new Date().toISOString(),
          data: {
            status: session.getStatus(),
            state: session.getState(),
            messageCount: session.getMessages().length,
          },
        };
        controller.enqueue(
          encoder.encode(this.formatSseEvent("connected", initialPayload)),
        );

        // Heartbeat interval (every 5s) to maintain active persistent stream and prevent idle drops
        heartbeatInterval = setInterval(() => {
          if (!isClosed) {
            try {
              controller.enqueue(
                encoder.encode(
                  this.formatSseEvent("heartbeat", {
                    type: "heartbeat",
                    sessionId,
                    timestamp: new Date().toISOString(),
                    data: { ping: true },
                  }),
                ),
              );
            } catch {
              cleanup(true);
            }
          }
        }, 5000);
      },
      cancel: () => {
        cleanup(false);
      },
    });

    const sendEvent = (eventType: string, data: unknown) => {
      if (isClosed || !controllerRef) return;
      try {
        const payload: StreamEventPayload = {
          type: eventType as StreamEventPayload["type"],
          sessionId,
          timestamp: new Date().toISOString(),
          data,
        };
        controllerRef.enqueue(
          encoder.encode(this.formatSseEvent(eventType, payload)),
        );
      } catch (_err) {
        cleanup(true);
      }
    };

    // Attach Session Event Observers
    const onThought = (thought: string) => sendEvent("thought", { thought });
    const onAction = (toolCalls: ToolCall[]) =>
      sendEvent("tool_start", { toolCalls });
    const onObservation = (results: ToolResult[]) =>
      sendEvent("tool_result", { results });
    const onStateChange = (to: string, from: string) =>
      sendEvent("state_change", { to, from });
    const onStatusChange = (status: string, prev: string) =>
      sendEvent("status_change", { status, prev, title: session.title });
    const onTitleChange = (title: string) =>
      sendEvent("status_change", {
        title,
        status: session.getStatus(),
        state: session.getState(),
      });
    const onMessage = (msg: AgentMessage) =>
      sendEvent("message", { message: msg });
    const onToken = (delta: string) => sendEvent("token", { delta });
    const onToolStdout = (data: { toolCallId: string; chunk: string }) =>
      sendEvent("tool_stdout", data);
    const onToolStderr = (data: { toolCallId: string; chunk: string }) =>
      sendEvent("tool_stderr", data);
    const onDone = (finalResponse: string) =>
      sendEvent("done", { finalResponse });
    const onError = (error: unknown) => {
      const serialized =
        error instanceof Error
          ? {
              message: error.message,
              name: error.name,
              stack: error.stack,
            }
          : error;
      sendEvent("error", { error: serialized });
    };

    session.on("thought", onThought);
    session.on("action", onAction);
    session.on("observation", onObservation);
    session.on("stateChange", onStateChange);
    session.on("statusChange", onStatusChange);
    session.on("titleChange", onTitleChange);
    session.on("message", onMessage);
    session.on("token", onToken);
    session.on("toolStdout", onToolStdout);
    session.on("toolStderr", onToolStderr);
    session.on("done", onDone);
    session.on("error", onError);

    const cleanup = (wasDropped: boolean) => {
      if (isClosed) return;
      isClosed = true;

      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      session.off("thought", onThought);
      session.off("action", onAction);
      session.off("observation", onObservation);
      session.off("stateChange", onStateChange);
      session.off("statusChange", onStatusChange);
      session.off("titleChange", onTitleChange);
      session.off("message", onMessage);
      session.off("token", onToken);
      session.off("toolStdout", onToolStdout);
      session.off("toolStderr", onToolStderr);
      session.off("done", onDone);
      session.off("error", onError);

      if (controllerRef && this.activeStreams.has(sessionId)) {
        this.activeStreams.get(sessionId)!.delete(controllerRef);
        if (this.activeStreams.get(sessionId)!.size === 0) {
          this.activeStreams.delete(sessionId);
        }
        if (!req.signal.aborted) {
          try {
            controllerRef.close();
          } catch {
            // already closed
          }
        }
      }

      this.metrics.totalSseConnectionsClosed += 1;
      this.metrics.activeSseConnections = this.getActiveCount();

      // Track unexpected disconnects during active session execution
      if (wasDropped || session.getStatus() === "running") {
        this.metrics.droppedSseConnections += 1;
        this.metrics.droppedPerSession[sessionId] =
          (this.metrics.droppedPerSession[sessionId] || 0) + 1;

        const errorReporter = getErrorReporter();
        errorReporter.captureAgentError(
          new Error(
            `SSE Stream connection unexpectedly dropped for session '${sessionId}'`,
          ),
          {
            sessionId,
            component: "SseStreamHandler",
            status: session.getStatus(),
            state: session.getState(),
            alert: "CRUCIBLE_STREAM_CONNECTION_DROPPED_ALERT",
          },
        );
      }
    };

    req.signal.addEventListener("abort", () => {
      cleanup(session.getStatus() === "running");
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  private formatSseEvent(event: string, payload: StreamEventPayload): string {
    return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  }
}
