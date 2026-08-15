import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { SessionStreamClient } from "./stream-client";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onerror: ((e?: any) => void) | null = null;
  listeners: Record<string, ((e: any) => void)[]> = {};
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (e: any) => void) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: (e: any) => void) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
    }
  }

  dispatchEvent(type: string, event: any) {
    const list = this.listeners[type] || [];
    for (const listener of list) {
      listener(event);
    }
  }

  close() {
    this.closed = true;
  }
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;

  url: string;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onclose: ((e: any) => void) | null = null;
  sentData: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentData.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
}

describe("Web UI SessionStreamClient", () => {
  const originalWindow = (globalThis as any).window;
  const originalEventSource = (globalThis as any).EventSource;
  const originalWebSocket = (globalThis as any).WebSocket;

  beforeEach(() => {
    MockEventSource.instances = [];
    MockWebSocket.instances = [];
    (globalThis as any).window = {};
    (globalThis as any).EventSource = MockEventSource;
    (globalThis as any).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).EventSource = originalEventSource;
    (globalThis as any).WebSocket = originalWebSocket;
  });

  it("should initialize with default options", () => {
    const client = new SessionStreamClient("test_sess_123");
    expect(client.sessionId).toBe("test_sess_123");
    expect(client.isConnected()).toBe(false);
  });

  it("should register and trigger event listeners", () => {
    const client = new SessionStreamClient("test_sess_456");
    const receivedTokens: string[] = [];

    const unsubscribe = client.on("token", (data) => {
      receivedTokens.push(data.delta);
    });

    (client as any).emit("token", { delta: "ChunkA" });
    (client as any).emit("token", { delta: "ChunkB" });

    expect(receivedTokens).toEqual(["ChunkA", "ChunkB"]);

    unsubscribe();
    (client as any).emit("token", { delta: "ChunkC" });
    expect(receivedTokens).toEqual(["ChunkA", "ChunkB"]);
  });

  it("should notify connection state changes", () => {
    const client = new SessionStreamClient("test_sess_789");
    const connectionStates: boolean[] = [];

    client.onConnectionChange((connected) => {
      connectionStates.push(connected);
    });

    (client as any).setConnected(true);
    (client as any).setConnected(false);

    expect(connectionStates).toEqual([false, true, false]);
  });

  it("should handle error event emissions cleanly", () => {
    const client = new SessionStreamClient("test_sess_err");
    const errors: unknown[] = [];

    client.on("error", (data) => {
      errors.push(data.error);
    });

    (client as any).emit("error", { error: "Network timeout" });
    expect(errors).toEqual(["Network timeout"]);
  });

  it("should handle native EventSource error events where event.data is undefined without throwing SyntaxError", () => {
    const client = new SessionStreamClient("test_sess_sse_err", {
      transport: "sse",
    });
    client.connect();

    expect(MockEventSource.instances.length).toBe(1);
    const es = MockEventSource.instances[0];

    es.onopen?.();
    expect(client.isConnected()).toBe(true);

    // Native browser connection drop fires an Event object where data is undefined
    expect(() => {
      es.dispatchEvent("error", { type: "error" });
    }).not.toThrow();

    expect(() => {
      es.dispatchEvent("error", { type: "error", data: undefined });
    }).not.toThrow();
  });

  it("should safely ignore non-string, empty, or whitespace-only SSE payloads across event types", () => {
    const client = new SessionStreamClient("test_sess_sse_empty", {
      transport: "sse",
    });
    client.connect();

    const es = MockEventSource.instances[0];
    const receivedTokens: string[] = [];
    client.on("token", (d) => receivedTokens.push(d.delta));

    expect(() => {
      es.dispatchEvent("token", null);
      es.dispatchEvent("token", undefined);
      es.dispatchEvent("token", { data: null });
      es.dispatchEvent("token", { data: undefined });
      es.dispatchEvent("token", { data: "" });
      es.dispatchEvent("token", { data: "   " });
      es.dispatchEvent("token", { data: 123 });
    }).not.toThrow();

    expect(receivedTokens.length).toBe(0);
  });

  it("should handle malformed JSON SSE payloads without throwing or crashing", () => {
    const client = new SessionStreamClient("test_sess_malformed", {
      transport: "sse",
    });
    client.connect();

    const es = MockEventSource.instances[0];
    const receivedErrors: unknown[] = [];
    client.on("error", (d) => receivedErrors.push(d.error));

    expect(() => {
      es.dispatchEvent("token", { data: "{broken json" });
      es.dispatchEvent("error", { data: "<html>502 Bad Gateway</html>" });
      es.dispatchEvent("thought", { data: "undefined" });
    }).not.toThrow();

    expect(receivedErrors.length).toBe(0);
  });

  it("should parse and deliver valid SSE JSON event payloads", () => {
    const client = new SessionStreamClient("test_sess_valid", {
      transport: "sse",
    });
    client.connect();

    const es = MockEventSource.instances[0];
    const tokens: string[] = [];
    const thoughts: string[] = [];
    const errors: unknown[] = [];

    client.on("token", (d) => tokens.push(d.delta));
    client.on("thought", (d) => thoughts.push(d.thought));
    client.on("error", (d) => errors.push(d.error));

    es.dispatchEvent("token", {
      data: JSON.stringify({ delta: "Hello from SSE" }),
    });
    es.dispatchEvent("thought", {
      data: JSON.stringify({ data: { thought: "Planning steps..." } }),
    });
    es.dispatchEvent("error", {
      data: JSON.stringify({ error: "Context limit exceeded" }),
    });

    expect(tokens).toEqual(["Hello from SSE"]);
    expect(thoughts).toEqual(["Planning steps..."]);
    expect(errors).toEqual(["Context limit exceeded"]);
  });

  it("should handle WebSocket messages resilience against undefined, empty, and malformed data", () => {
    const client = new SessionStreamClient("test_sess_ws", {
      transport: "ws",
    });
    client.connect();

    expect(MockWebSocket.instances.length).toBe(1);
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();

    const tokens: string[] = [];
    client.on("token", (d) => tokens.push(d.delta));

    expect(() => {
      ws.onmessage?.(null as any);
      ws.onmessage?.({ data: undefined });
      ws.onmessage?.({ data: "" });
      ws.onmessage?.({ data: "   " });
      ws.onmessage?.({ data: "{invalid json" });
    }).not.toThrow();

    ws.onmessage?.({
      data: JSON.stringify({
        type: "token",
        delta: "WS Token Chunk",
      }),
    });

    expect(tokens).toEqual(["WS Token Chunk"]);
  });

  it("should trigger onerror and schedule reconnect on transport failure", () => {
    const client = new SessionStreamClient("test_sess_reconnect", {
      transport: "sse",
      reconnect: true,
      maxReconnectAttempts: 3,
      reconnectIntervalMs: 10,
    });
    client.connect();

    const es = MockEventSource.instances[0];
    es.onopen?.();
    expect(client.isConnected()).toBe(true);

    es.onerror?.({ type: "error" });
    expect(client.isConnected()).toBe(false);
    expect(es.closed).toBe(true);

    client.disconnect();
  });
});
