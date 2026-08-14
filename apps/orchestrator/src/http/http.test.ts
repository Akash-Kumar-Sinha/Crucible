import { describe, expect, it } from "bun:test";
import { SessionManager } from "../session/session-manager";
import { ToolRegistry } from "../tools/registry";
import { createHttpRouter } from "./server";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../provider/provider.interface";

class MockProvider implements ModelProvider {
  readonly name = "mock";
  readonly defaultModel = "mock-model";

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const lastUserMsg = request.messages[request.messages.length - 1];
    return {
      content: `Echo answer for: ${lastUserMsg?.content || ""}`,
      finishReason: "stop",
    };
  }
}

describe("Orchestrator REST API (Core HTTP Layer)", () => {
  const provider = new MockProvider();
  const tools = new ToolRegistry();
  const sessionManager = new SessionManager({
    defaultProvider: provider,
    defaultTools: tools,
    defaultSystemPrompt: "Test System Prompt",
  });
  const router = createHttpRouter(sessionManager);

  it("should return 200 OK for GET /health", async () => {
    const req = new Request("http://localhost:4000/health", { method: "GET" });
    const res = await router(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("crucible-orchestrator");
  });

  it("should handle CORS preflight OPTIONS request", async () => {
    const req = new Request("http://localhost:4000/sessions", {
      method: "OPTIONS",
    });
    const res = await router(req);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("should create a session via POST /sessions", async () => {
    const req = new Request("http://localhost:4000/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Custom Title" }),
    });
    const res = await router(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.title).toBe("Custom Title");
    expect(body.status).toBe("idle");
  });

  it("should list active sessions via GET /sessions", async () => {
    const req = new Request("http://localhost:4000/sessions", {
      method: "GET",
    });
    const res = await router(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it("should get session details via GET /sessions/:id", async () => {
    const createReq = new Request("http://localhost:4000/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Detail Test" }),
    });
    const createRes = await router(createReq);
    const { id } = await createRes.json();

    const getReq = new Request(`http://localhost:4000/sessions/${id}`, {
      method: "GET",
    });
    const getRes = await router(getReq);
    expect(getRes.status).toBe(200);

    const body = await getRes.json();
    expect(body.id).toBe(id);
    expect(body.title).toBe("Detail Test");
    expect(body.status).toBe("idle");
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it("should return 404 for unknown session id", async () => {
    const req = new Request("http://localhost:4000/sessions/non-existent-id", {
      method: "GET",
    });
    const res = await router(req);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("should post user message and receive response via POST /sessions/:id/messages", async () => {
    const createReq = new Request("http://localhost:4000/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Message Test" }),
    });
    const createRes = await router(createReq);
    const { id } = await createRes.json();

    const msgReq = new Request(
      `http://localhost:4000/sessions/${id}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Hello from browser" }),
      },
    );
    const msgRes = await router(msgReq);
    expect(msgRes.status).toBe(200);

    const body = await msgRes.json();
    expect(body.sessionId).toBe(id);
    expect(body.response).toContain("Echo answer for: Hello from browser");
    expect(body.messages.length).toBeGreaterThanOrEqual(2);
  });

  it("should delete session via DELETE /sessions/:id", async () => {
    const createReq = new Request("http://localhost:4000/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "To Delete" }),
    });
    const createRes = await router(createReq);
    const { id } = await createRes.json();

    const delReq = new Request(`http://localhost:4000/sessions/${id}`, {
      method: "DELETE",
    });
    const delRes = await router(delReq);
    expect(delRes.status).toBe(200);

    const getReq = new Request(`http://localhost:4000/sessions/${id}`, {
      method: "GET",
    });
    const getRes = await router(getReq);
    expect(getRes.status).toBe(404);
  });
});
