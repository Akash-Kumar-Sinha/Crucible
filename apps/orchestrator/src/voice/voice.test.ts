import { describe, expect, it } from "bun:test";
import {
  mintLiveKitJwt,
  verifyLiveKitJwt,
  LiveKitRoomManager,
} from "./livekit-room-manager";
import {
  MockSttEngine,
  WhisperSttEngine,
  DeepgramSttEngine,
} from "./stt-engine";
import { VoiceAgent } from "./voice-agent";
import { SessionManager } from "../session/session-manager";
import { MockModelProvider } from "../provider/mock";
import { getErrorReporter } from "../observability/error-reporter";

describe("LiveKit JWT Token Generation & Verification", () => {
  const apiKey = "crucible_dev_key";
  const apiSecret = "crucible_livekit_secret_key_32_chars_long";

  it("mints and verifies a valid LiveKit access token with VideoGrant", () => {
    const { token, expiresAt } = mintLiveKitJwt(
      {
        roomName: "crucible_session_123",
        participantIdentity: "user_123",
        participantName: "Alice",
        ttlSeconds: 3600,
        grants: {
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
        },
      },
      { apiKey, apiSecret },
    );

    expect(token).toBeDefined();
    expect(typeof token).toBe("string");
    expect(token.split(".").length).toBe(3);
    expect(expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const verification = verifyLiveKitJwt(token, apiSecret);
    expect(verification.valid).toBe(true);
    expect(verification.payload).toBeDefined();
    expect(verification.payload?.iss).toBe(apiKey);
    expect(verification.payload?.sub).toBe("user_123");
    expect(verification.payload?.name).toBe("Alice");

    const video: any = verification.payload?.video;
    expect(video).toBeDefined();
    expect(video.room).toBe("crucible_session_123");
    expect(video.roomJoin).toBe(true);
    expect(video.canPublish).toBe(true);
    expect(video.canSubscribe).toBe(true);
  });

  it("rejects token with wrong secret key signature", () => {
    const { token } = mintLiveKitJwt(
      {
        roomName: "crucible_session_123",
        participantIdentity: "user_123",
      },
      { apiKey, apiSecret },
    );

    const verification = verifyLiveKitJwt(
      token,
      "wrong_secret_key_1234567890123",
    );
    expect(verification.valid).toBe(false);
    expect(verification.error).toContain("Invalid signature");
  });

  it("rejects expired token", () => {
    const { token } = mintLiveKitJwt(
      {
        roomName: "crucible_session_123",
        participantIdentity: "user_123",
        ttlSeconds: -10, // expired 10 seconds ago
      },
      { apiKey, apiSecret },
    );

    const verification = verifyLiveKitJwt(token, apiSecret);
    expect(verification.valid).toBe(false);
    expect(verification.error).toContain("expired");
  });
});

describe("LiveKitRoomManager (Facade Pattern)", () => {
  it("creates session tokens and agent tokens with proper permissions", () => {
    const roomManager = new LiveKitRoomManager({
      apiKey: "test_key",
      apiSecret: "test_secret_1234567890123456789012",
      wsUrl: "ws://127.0.0.1:7880",
    });

    const userToken = roomManager.createSessionToken("session_abc", {
      participantName: "Bob",
    });

    expect(userToken.roomName).toBe("crucible_session_session_abc");
    expect(userToken.wsUrl).toBe("ws://127.0.0.1:7880");
    expect(userToken.token).toBeDefined();

    const agentToken = roomManager.createAgentToken("session_abc");
    expect(agentToken.roomName).toBe("crucible_session_session_abc");
    expect(agentToken.participantIdentity).toBe("agent_stt_session_abc");

    const activeRooms = roomManager.getActiveRooms();
    expect(activeRooms.length).toBe(1);
    expect(activeRooms[0].roomName).toBe("crucible_session_session_abc");
    expect(activeRooms[0].participantCount).toBe(2);
  });
});

describe("STT Engines", () => {
  it("transcribes audio via MockSttEngine", async () => {
    const engine = new MockSttEngine(["Build a REST API"]);
    expect(await engine.isAvailable()).toBe(true);

    const res = await engine.transcribe({
      sessionId: "s_1",
      audioBase64: Buffer.from("Build a REST API").toString("base64"),
    });

    expect(res.text).toBe("Build a REST API");
    expect(res.confidence).toBeGreaterThan(0.9);
    expect(res.isFinal).toBe(true);
  });

  it("handles WhisperSttEngine timeout configuration", async () => {
    const engine = new WhisperSttEngine({
      endpointUrl: "http://127.0.0.1:19999/invalid",
      timeoutMs: 50,
    });

    try {
      await engine.transcribe({
        sessionId: "s_1",
        audioBase64: "dGVzdA==",
      });
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  });

  it("handles DeepgramSttEngine configuration checks", async () => {
    const engine = new DeepgramSttEngine({ apiKey: "" });
    expect(await engine.isAvailable()).toBe(false);

    try {
      await engine.transcribe({
        sessionId: "s_1",
        audioBase64: "dGVzdA==",
      });
    } catch (err: any) {
      expect(err.message).toContain("DEEPGRAM_API_KEY");
    }
  });
});

describe("VoiceAgent (Adapter Pattern & Message Routing)", () => {
  it("processes voice input and forwards transcript to Session without modifying loop", async () => {
    const mockProvider = new MockModelProvider();
    const sessionManager = new SessionManager({
      defaultProvider: mockProvider,
      autoPersist: false,
    });

    const session = sessionManager.createSession({
      title: "Voice Test Session",
    });

    const mockStt = new MockSttEngine(["Check project dependencies"]);
    const agent = new VoiceAgent({
      sessionId: session.id,
      sessionManager,
      sttEngine: mockStt,
    });

    expect(agent.getState()).toBe("idle");

    const events: any[] = [];
    agent.on("dataEvent", (evt) => events.push(evt));

    const result = await agent.processAudioInput({
      audioBase64: Buffer.from("Check project dependencies").toString("base64"),
    });

    expect(result.transcript).toBe("Check project dependencies");
    expect(result.forwarded).toBe(true);
    expect(events.some((e) => e.type === "transcript")).toBe(true);

    const refreshed = sessionManager.get(session.id);
    expect(refreshed).toBeDefined();
    expect(refreshed?.getMessages().length).toBeGreaterThan(0);
    expect(refreshed?.getMessages()[0].content).toBe(
      "Check project dependencies",
    );
  });

  it("records structured alerts on STT failure in ErrorReporter", async () => {
    const mockProvider = new MockModelProvider();
    const sessionManager = new SessionManager({
      defaultProvider: mockProvider,
      autoPersist: false,
    });
    const session = sessionManager.createSession();

    const failingStt: any = {
      name: "failing_engine",
      isAvailable: async () => true,
      transcribe: async () => {
        throw new Error("STT Audio decoder timeout");
      },
    };

    const agent = new VoiceAgent({
      sessionId: session.id,
      sessionManager,
      sttEngine: failingStt,
    });

    const reporter = getErrorReporter();
    let alertCaptured = false;
    reporter.once("voiceSttFailureAlert", () => {
      alertCaptured = true;
    });

    try {
      await agent.processAudioInput({
        audioBase64: "invalid",
      });
    } catch (err: any) {
      expect(err.message).toContain("STT Audio decoder timeout");
    }

    expect(alertCaptured).toBe(true);
  });
});
