import { describe, expect, it } from "bun:test";
import { SessionManager } from "../session/session-manager";
import { ToolRegistry } from "../tools/registry";
import { SseStreamHandler } from "./sse";
import { WebSocketGateway } from "./ws-gateway";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../provider/provider.interface";

class MockProvider implements ModelProvider {
  readonly name = "mock";
  readonly defaultModel = "mock-model";

  async complete(request: ModelRequest): Promise<ModelResponse> {
    return {
      content: "Stream test answer",
      finishReason: "stop",
    };
  }
}

describe("Real-Time Streaming Subsystem (Observer & Pub-Sub Pattern)", () => {
  const provider = new MockProvider();
  const tools = new ToolRegistry();

  it("should stream SSE events to subscribed client", async () => {
    const sessionManager = new SessionManager({
      defaultProvider: provider,
      defaultTools: tools,
    });
    const sseHandler = new SseStreamHandler(sessionManager);
    const session = sessionManager.createSession({ title: "SSE Stream Test" });

    const req = new Request(
      `http://localhost:4000/sessions/${session.id}/stream`,
      {
        method: "GET",
      },
    );
    const res = sseHandler.handleStreamRequest(session.id, req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    // Read initial connected event frame
    const { value: initialChunk } = await reader!.read();
    const initialText = new TextDecoder().decode(initialChunk);
    expect(initialText).toContain("event: connected");
    expect(initialText).toContain(session.id);

    // Emit streaming token from session
    session.emit("token", "LiveTokenChunk");

    const { value: tokenChunk } = await reader!.read();
    const tokenText = new TextDecoder().decode(tokenChunk);
    expect(tokenText).toContain("event: token");
    expect(tokenText).toContain("LiveTokenChunk");

    // Emit real-time stdout chunk from tool
    session.emit("toolStdout", {
      toolCallId: "call_1",
      chunk: "building package...\n",
    });

    const { value: toolChunk } = await reader!.read();
    const toolText = new TextDecoder().decode(toolChunk);
    expect(toolText).toContain("event: tool_stdout");
    expect(toolText).toContain("building package...");

    reader?.cancel();
  });

  it("should track dropped SSE connections as a health metric", async () => {
    const sessionManager = new SessionManager({
      defaultProvider: provider,
      defaultTools: tools,
    });
    const sseHandler = new SseStreamHandler(sessionManager);
    const session = sessionManager.createSession({ title: "Drop Test" });

    const abortController = new AbortController();
    const req = new Request(
      `http://localhost:4000/sessions/${session.id}/stream`,
      {
        method: "GET",
        signal: abortController.signal,
      },
    );

    const res = sseHandler.handleStreamRequest(session.id, req);
    const reader = res.body?.getReader();

    // Simulate session in running state when connection is severed
    (session as any).status = "running";

    // Abort connection abruptly
    abortController.abort();

    const metrics = sseHandler.getMetrics();
    expect(metrics.totalSseConnectionsOpened).toBeGreaterThanOrEqual(1);
    expect(metrics.droppedSseConnections).toBeGreaterThanOrEqual(1);
    expect(metrics.droppedPerSession[session.id]).toBeGreaterThanOrEqual(1);

    reader?.cancel();
  });

  it("should manage WebSocket gateway subscriptions and pub-sub fanout", async () => {
    const sessionManager = new SessionManager({
      defaultProvider: provider,
      defaultTools: tools,
    });
    const wsGateway = new WebSocketGateway(sessionManager);
    const session = sessionManager.createSession({ title: "WS Fanout Test" });

    const sentMessages: string[] = [];
    const mockWs: any = {
      data: {
        sessionId: session.id,
        subscribedSessions: new Set([session.id]),
        connectedAt: new Date(),
      },
      send: (msg: string) => sentMessages.push(msg),
    };

    wsGateway.handleOpen(mockWs);
    expect(sentMessages.length).toBeGreaterThanOrEqual(1);
    expect(sentMessages[0]).toContain(
      "Crucible Real-Time WebSocket Gateway Connected",
    );

    // Broadcast session event
    session.emit("thought", "Analyzing system architecture...");
    expect(
      sentMessages.some((m) => m.includes("Analyzing system architecture...")),
    ).toBe(true);

    // Broadcast tool stdout
    session.emit("toolStdout", {
      toolCallId: "call_ws",
      chunk: "running cargo test...",
    });
    expect(sentMessages.some((m) => m.includes("running cargo test..."))).toBe(
      true,
    );

    // Test ping-pong
    await wsGateway.handleMessage(mockWs, JSON.stringify({ type: "ping" }));
    expect(sentMessages.some((m) => m.includes('"type":"pong"'))).toBe(true);

    // Test close and dropped metrics
    (session as any).status = "running";
    wsGateway.handleClose(mockWs, 1006, "Abnormal closure");

    const metrics = wsGateway.getMetrics();
    expect(metrics.droppedWsConnections).toBeGreaterThanOrEqual(1);
  });
});
