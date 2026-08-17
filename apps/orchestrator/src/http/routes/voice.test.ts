import { describe, expect, it } from "bun:test";
import { createHttpRouter } from "../server";
import { SessionManager } from "../../session/session-manager";
import { MockModelProvider } from "../../provider/mock";

describe("Voice REST Route Endpoints", () => {
  const provider = new MockModelProvider();
  const sessionManager = new SessionManager({
    defaultProvider: provider,
    autoPersist: false,
  });
  const router = createHttpRouter(sessionManager);

  it("POST /sessions/:id/voice/token returns 404 for nonexistent session", async () => {
    const req = new Request(
      "http://localhost:4000/sessions/nonexistent/voice/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantName: "Alice" }),
      },
    );

    const res = await router(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.status).toBe("error");
    expect(json.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("POST /sessions/:id/voice/token mints access token for active session", async () => {
    const session = sessionManager.createSession({ title: "Voice Route Test" });

    const req = new Request(
      `http://localhost:4000/sessions/${session.id}/voice/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantName: "Alice" }),
      },
    );

    const res = await router(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("success");
    expect(json.data.token).toBeDefined();
    expect(json.data.roomName).toBe(`crucible_session_${session.id}`);
    expect(json.data.participantIdentity).toBeDefined();
    expect(json.data.wsUrl).toBeDefined();
    expect(json.data.agentIdentity).toBe(`agent_stt_${session.id}`);
  });

  it("POST /sessions/:id/voice/transcribe processes voice audio payload", async () => {
    const session = sessionManager.createSession({ title: "Transcribe Test" });

    const req = new Request(
      `http://localhost:4000/sessions/${session.id}/voice/transcribe`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64: Buffer.from("Run unit tests").toString("base64"),
          mimeType: "audio/webm",
        }),
      },
    );

    const res = await router(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("success");
    expect(json.data.transcript).toBeDefined();
    expect(json.data.durationMs).toBeGreaterThanOrEqual(0);
    expect(json.data.forwarded).toBe(true);
  });

  it("GET /sessions/:id/voice/status returns voice session state", async () => {
    const session = sessionManager.createSession({ title: "Status Test" });

    const req = new Request(
      `http://localhost:4000/sessions/${session.id}/voice/status`,
      { method: "GET" },
    );

    const res = await router(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("success");
    expect(json.data.sessionId).toBe(session.id);
    expect(json.data.roomName).toBe(`crucible_session_${session.id}`);
    expect(json.data.agentState).toBeDefined();
  });

  it("GET /voice/status returns global voice status", async () => {
    const req = new Request("http://localhost:4000/voice/status", {
      method: "GET",
    });

    const res = await router(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("success");
    expect(typeof json.data.activeRoomCount).toBe("number");
  });
});
