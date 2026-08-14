import type { ServerWebSocket } from "bun";
import type { SessionManager } from "../session/session-manager";
import type { Session } from "../session/session";
import { getErrorReporter } from "../observability/error-reporter";
import type { AgentMessage, ToolCall, ToolResult } from "../schema/envelope";

export interface WsConnectionData {
  sessionId?: string;
  subscribedSessions: Set<string>;
  connectedAt: Date;
}

export interface WsGatewayMetrics {
  activeWsConnections: number;
  totalWsConnectionsOpened: number;
  totalWsConnectionsClosed: number;
  droppedWsConnections: number;
  droppedPerSession: Record<string, number>;
}

export class WebSocketGateway {
  private sessionManager: SessionManager;
  private subscribers: Map<string, Set<ServerWebSocket<WsConnectionData>>> =
    new Map();
  private sessionListeners: Map<string, () => void> = new Map();
  private metrics: WsGatewayMetrics = {
    activeWsConnections: 0,
    totalWsConnectionsOpened: 0,
    totalWsConnectionsClosed: 0,
    droppedWsConnections: 0,
    droppedPerSession: {},
  };

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  getMetrics(): WsGatewayMetrics {
    return {
      ...this.metrics,
      activeWsConnections: this.getActiveConnectionsCount(),
      droppedPerSession: { ...this.metrics.droppedPerSession },
    };
  }

  private getActiveConnectionsCount(): number {
    const uniqueSockets = new Set<ServerWebSocket<WsConnectionData>>();
    for (const sockets of this.subscribers.values()) {
      for (const ws of sockets) {
        uniqueSockets.add(ws);
      }
    }
    return uniqueSockets.size;
  }

  /**
   * Called when a new WebSocket connection is established.
   */
  handleOpen(ws: ServerWebSocket<WsConnectionData>): void {
    this.metrics.totalWsConnectionsOpened += 1;
    this.metrics.activeWsConnections = this.getActiveConnectionsCount();

    // If initial sessionId was specified in upgrade request, auto-subscribe
    if (ws.data?.sessionId) {
      this.subscribe(ws, ws.data.sessionId);
    }

    ws.send(
      JSON.stringify({
        type: "connected",
        timestamp: new Date().toISOString(),
        message: "Crucible Real-Time WebSocket Gateway Connected",
      }),
    );
  }

  /**
   * Called when a message is received from a WebSocket client.
   */
  async handleMessage(
    ws: ServerWebSocket<WsConnectionData>,
    message: string | Buffer,
  ): Promise<void> {
    try {
      const text =
        typeof message === "string" ? message : message.toString("utf-8");
      const parsed = JSON.parse(text);

      switch (parsed.type) {
        case "subscribe": {
          if (parsed.sessionId) {
            this.subscribe(ws, parsed.sessionId);
            ws.send(
              JSON.stringify({
                type: "subscribed",
                sessionId: parsed.sessionId,
                timestamp: new Date().toISOString(),
              }),
            );
          }
          break;
        }

        case "unsubscribe": {
          if (parsed.sessionId) {
            this.unsubscribe(ws, parsed.sessionId);
            ws.send(
              JSON.stringify({
                type: "unsubscribed",
                sessionId: parsed.sessionId,
                timestamp: new Date().toISOString(),
              }),
            );
          }
          break;
        }

        case "ping": {
          ws.send(
            JSON.stringify({
              type: "pong",
              timestamp: new Date().toISOString(),
            }),
          );
          break;
        }

        case "prompt": {
          if (parsed.sessionId && parsed.text) {
            const session = this.sessionManager.getSession(parsed.sessionId);
            if (!session) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  sessionId: parsed.sessionId,
                  error: `Session '${parsed.sessionId}' not found`,
                }),
              );
              return;
            }

            // Ensure client is subscribed to the session topic
            this.subscribe(ws, parsed.sessionId);

            // Execute prompt asynchronously (events fan out to all subscribers)
            session.prompt(parsed.text).catch((err) => {
              ws.send(
                JSON.stringify({
                  type: "error",
                  sessionId: parsed.sessionId,
                  error: err?.message || String(err),
                }),
              );
            });
          }
          break;
        }

        default: {
          ws.send(
            JSON.stringify({
              type: "error",
              error: `Unknown message type: '${parsed.type}'`,
            }),
          );
        }
      }
    } catch (err: any) {
      ws.send(
        JSON.stringify({
          type: "error",
          error: "Invalid JSON message envelope",
          details: err?.message || String(err),
        }),
      );
    }
  }

  /**
   * Called when a WebSocket connection is closed or lost.
   */
  handleClose(
    ws: ServerWebSocket<WsConnectionData>,
    code: number,
    reason: string,
  ): void {
    const subscribed = ws.data?.subscribedSessions || new Set();

    for (const sessionId of subscribed) {
      this.unsubscribe(ws, sessionId);

      const session = this.sessionManager.getSession(sessionId);
      if (session && session.getStatus() === "running") {
        this.metrics.droppedWsConnections += 1;
        this.metrics.droppedPerSession[sessionId] =
          (this.metrics.droppedPerSession[sessionId] || 0) + 1;

        const errorReporter = getErrorReporter();
        errorReporter.captureAgentError(
          new Error(
            `WebSocket client connection dropped during active run for session '${sessionId}' (code: ${code})`,
          ),
          {
            sessionId,
            component: "WebSocketGateway",
            status: session.getStatus(),
            code,
            reason,
            alert: "CRUCIBLE_STREAM_CONNECTION_DROPPED_ALERT",
          },
        );
      }
    }

    this.metrics.totalWsConnectionsClosed += 1;
    this.metrics.activeWsConnections = this.getActiveConnectionsCount();
  }

  /**
   * Subscribes a WebSocket client to a session's event stream.
   */
  subscribe(ws: ServerWebSocket<WsConnectionData>, sessionId: string): void {
    if (!this.subscribers.has(sessionId)) {
      this.subscribers.set(sessionId, new Set());
      this.bindSessionEvents(sessionId);
    }

    this.subscribers.get(sessionId)!.add(ws);
    if (!ws.data) {
      ws.data = {
        sessionId,
        subscribedSessions: new Set([sessionId]),
        connectedAt: new Date(),
      };
    } else {
      if (!ws.data.subscribedSessions) {
        ws.data.subscribedSessions = new Set();
      }
      ws.data.subscribedSessions.add(sessionId);
    }

    this.metrics.activeWsConnections = this.getActiveConnectionsCount();
  }

  /**
   * Unsubscribes a WebSocket client from a session's event stream.
   */
  unsubscribe(ws: ServerWebSocket<WsConnectionData>, sessionId: string): void {
    if (this.subscribers.has(sessionId)) {
      const set = this.subscribers.get(sessionId)!;
      set.delete(ws);
      if (set.size === 0) {
        this.subscribers.delete(sessionId);
        this.unbindSessionEvents(sessionId);
      }
    }

    if (ws.data?.subscribedSessions) {
      ws.data.subscribedSessions.delete(sessionId);
    }

    this.metrics.activeWsConnections = this.getActiveConnectionsCount();
  }

  /**
   * Binds session events to broadcast to all WebSocket subscribers for that session topic.
   */
  private bindSessionEvents(sessionId: string): void {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return;

    const broadcast = (eventType: string, data: unknown) => {
      const subscribers = this.subscribers.get(sessionId);
      if (!subscribers || subscribers.size === 0) return;

      const payload = JSON.stringify({
        type: eventType,
        sessionId,
        timestamp: new Date().toISOString(),
        data,
      });

      for (const client of subscribers) {
        try {
          client.send(payload);
        } catch {
          // Socket write failed, cleanup handled on close
        }
      }
    };

    const onThought = (thought: string) => broadcast("thought", { thought });
    const onAction = (toolCalls: ToolCall[]) =>
      broadcast("tool_start", { toolCalls });
    const onObservation = (results: ToolResult[]) =>
      broadcast("tool_result", { results });
    const onStateChange = (to: string, from: string) =>
      broadcast("state_change", { to, from });
    const onStatusChange = (status: string, prev: string) =>
      broadcast("status_change", { status, prev });
    const onMessage = (msg: AgentMessage) =>
      broadcast("message", { message: msg });
    const onToken = (delta: string) => broadcast("token", { delta });
    const onToolStdout = (data: { toolCallId: string; chunk: string }) =>
      broadcast("tool_stdout", data);
    const onToolStderr = (data: { toolCallId: string; chunk: string }) =>
      broadcast("tool_stderr", data);
    const onDone = (finalResponse: string) =>
      broadcast("done", { finalResponse });
    const onError = (error: unknown) => broadcast("error", { error });

    session.on("thought", onThought);
    session.on("action", onAction);
    session.on("observation", onObservation);
    session.on("stateChange", onStateChange);
    session.on("statusChange", onStatusChange);
    session.on("message", onMessage);
    session.on("token", onToken);
    session.on("toolStdout", onToolStdout);
    session.on("toolStderr", onToolStderr);
    session.on("done", onDone);
    session.on("error", onError);

    this.sessionListeners.set(sessionId, () => {
      session.off("thought", onThought);
      session.off("action", onAction);
      session.off("observation", onObservation);
      session.off("stateChange", onStateChange);
      session.off("statusChange", onStatusChange);
      session.off("message", onMessage);
      session.off("token", onToken);
      session.off("toolStdout", onToolStdout);
      session.off("toolStderr", onToolStderr);
      session.off("done", onDone);
      session.off("error", onError);
    });
  }

  private unbindSessionEvents(sessionId: string): void {
    const unbind = this.sessionListeners.get(sessionId);
    if (unbind) {
      unbind();
      this.sessionListeners.delete(sessionId);
    }
  }
}
