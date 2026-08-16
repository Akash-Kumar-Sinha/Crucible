import type { AgentMessage, ToolCall, ToolResult } from "./orchestrator-client";
import { getOrchestratorUrl } from "../config/orchestrator-url";

export interface StreamEventMap {
  connected: { status: string; state: string; messageCount: number };
  token: { delta: string };
  thought: { thought: string };
  tool_start: { toolCalls: ToolCall[] };
  tool_stdout: { toolCallId: string; chunk: string };
  tool_stderr: { toolCallId: string; chunk: string };
  tool_result: { results: ToolResult[] };
  state_change: { to: string; from: string };
  status_change: { status: string; prev?: string };
  queued: { jobId?: string; queuePosition?: number; backlogCount?: number };
  message: { message: AgentMessage };
  inter_session_message: { message: any };
  done: { finalResponse?: string };
  error: { error: unknown };
  heartbeat: { ping: boolean };
}

export type StreamEventListener<K extends keyof StreamEventMap> = (
  data: StreamEventMap[K],
) => void;

export interface StreamClientOptions {
  baseUrl?: string;
  transport?: "sse" | "ws";
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectIntervalMs?: number;
}

export class SessionStreamClient {
  readonly sessionId: string;
  private baseUrl: string;
  private transport: "sse" | "ws";
  private reconnect: boolean;
  private maxReconnectAttempts: number;
  private reconnectIntervalMs: number;

  private eventSource: EventSource | null = null;
  private webSocket: WebSocket | null = null;
  private listeners: Partial<{
    [K in keyof StreamEventMap]: Set<StreamEventListener<K>>;
  }> = {};
  private connectionListeners: Set<(connected: boolean) => void> = new Set();

  private isConnectedState = false;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  private manuallyClosed = false;

  constructor(sessionId: string, options: StreamClientOptions = {}) {
    this.sessionId = sessionId;
    this.baseUrl = (options.baseUrl || getOrchestratorUrl()).replace(/\/$/, "");
    this.transport = options.transport || "sse";
    this.reconnect = options.reconnect !== false;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.reconnectIntervalMs = options.reconnectIntervalMs || 1500;
  }

  isConnected(): boolean {
    return this.isConnectedState;
  }

  connect(): this {
    this.manuallyClosed = false;
    if (this.transport === "ws") {
      this.connectWebSocket();
    } else {
      this.connectSse();
    }
    return this;
  }

  private connectSse(): void {
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    this.disconnect();
    this.manuallyClosed = false;
    const url = `${this.baseUrl}/api/sessions/${this.sessionId}/stream`;

    try {
      const es = new EventSource(url);
      this.eventSource = es;

      es.onopen = () => {
        this.reconnectAttempts = 0;
        this.setConnected(true);
      };

      es.onerror = () => {
        // If native EventSource is in CONNECTING state (0), let it auto-reconnect without closing
        if (es.readyState === 0) {
          return;
        }

        this.setConnected(false);
        if (!this.manuallyClosed) {
          try {
            es.close();
          } catch {
            // ignore
          }
          this.eventSource = null;
          this.scheduleReconnect();
        }
      };

      // Register event listeners on EventSource
      const eventTypes: Array<keyof StreamEventMap> = [
        "connected",
        "token",
        "thought",
        "tool_start",
        "tool_stdout",
        "tool_stderr",
        "tool_result",
        "state_change",
        "status_change",
        "queued",
        "message",
        "done",
        "error",
        "heartbeat",
      ];

      for (const eventType of eventTypes) {
        es.addEventListener(eventType, (e: any) => {
          if (!this.isConnectedState) {
            this.setConnected(true);
          }
          if (!e || typeof e.data !== "string" || !e.data.trim()) {
            return;
          }
          try {
            const parsed = JSON.parse(e.data);
            this.emit(eventType, parsed.data || parsed);
          } catch {
            // Ignore parse errors on network events or malformed payloads
          }
        });
      }
    } catch (err) {
      console.error("[Crucible SSE] Failed to create EventSource:", err);
      this.scheduleReconnect();
    }
  }

  private connectWebSocket(): void {
    if (typeof window === "undefined" || typeof WebSocket === "undefined") {
      return;
    }

    this.disconnect();
    this.manuallyClosed = false;
    const wsBase = this.baseUrl.replace(/^http/, "ws");
    const url = `${wsBase}/ws?sessionId=${this.sessionId}`;

    try {
      const ws = new WebSocket(url);
      this.webSocket = ws;

      ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setConnected(true);
        // Subscribe to session topic
        ws.send(
          JSON.stringify({ type: "subscribe", sessionId: this.sessionId }),
        );
      };

      ws.onmessage = (event) => {
        if (!event || typeof event.data !== "string" || !event.data.trim()) {
          return;
        }
        try {
          const parsed = JSON.parse(event.data);
          if (
            parsed &&
            typeof parsed === "object" &&
            parsed.type &&
            parsed.type in this.listeners
          ) {
            this.emit(
              parsed.type as keyof StreamEventMap,
              parsed.data || parsed,
            );
          }
        } catch {
          // Ignore malformed ws payloads
        }
      };

      ws.onerror = () => {
        this.setConnected(false);
      };

      ws.onclose = () => {
        this.setConnected(false);
        this.webSocket = null;
        this.scheduleReconnect();
      };
    } catch (err) {
      console.error("[Crucible WS] Failed to create WebSocket:", err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.manuallyClosed || !this.reconnect) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(
        `[Crucible Stream] Reached max reconnect attempts (${this.maxReconnectAttempts}) for session '${this.sessionId}'`,
      );
      return;
    }

    const backoffDelay = Math.min(
      this.reconnectIntervalMs * Math.pow(1.5, this.reconnectAttempts),
      15000,
    );
    this.reconnectAttempts += 1;

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.manuallyClosed && !this.isConnectedState) {
        this.connect();
      }
    }, backoffDelay);
  }

  private setConnected(connected: boolean): void {
    if (this.isConnectedState !== connected) {
      this.isConnectedState = connected;
      for (const listener of this.connectionListeners) {
        listener(connected);
      }
    }
  }

  on<K extends keyof StreamEventMap>(
    event: K,
    listener: StreamEventListener<K>,
  ): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set() as any;
    }
    (this.listeners[event] as Set<StreamEventListener<K>>).add(listener);

    return () => {
      (this.listeners[event] as Set<StreamEventListener<K>>)?.delete(listener);
    };
  }

  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.add(listener);
    listener(this.isConnectedState);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  private emit<K extends keyof StreamEventMap>(
    event: K,
    data: StreamEventMap[K],
  ): void {
    const set = this.listeners[event] as
      Set<StreamEventListener<K>> | undefined;
    if (set) {
      for (const listener of set) {
        try {
          listener(data);
        } catch (err) {
          console.error(
            `[Crucible Stream] Error in listener for '${event}':`,
            err,
          );
        }
      }
    }
  }

  sendPrompt(text: string): void {
    if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
      this.webSocket.send(
        JSON.stringify({
          type: "prompt",
          sessionId: this.sessionId,
          text,
        }),
      );
    } else {
      throw new Error(
        "WebSocket transport is not active or connected for direct prompt submission",
      );
    }
  }

  disconnect(): void {
    this.manuallyClosed = true;
    clearTimeout(this.reconnectTimer);

    if (this.eventSource) {
      const es = this.eventSource;
      this.eventSource = null;
      es.onerror = null;
      es.onopen = null;
      try {
        es.close();
      } catch {
        // ignore
      }
    }

    if (this.webSocket) {
      const ws = this.webSocket;
      this.webSocket = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
    }

    this.setConnected(false);
  }

  dispose(): void {
    this.disconnect();
    this.listeners = {};
    this.connectionListeners.clear();
  }
}
