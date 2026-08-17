import type { SessionManager } from "../../session/session-manager";
import { LiveKitRoomManager } from "../../voice/livekit-room-manager";
import { VoiceAgent } from "../../voice/voice-agent";
import { createDefaultSttEngine } from "../../voice/stt-engine";
import { logger } from "../../observability/logger";

export class VoiceRouteHandler {
  private sessionManager: SessionManager;
  private roomManager: LiveKitRoomManager;
  private voiceAgents = new Map<string, VoiceAgent>();

  constructor(
    sessionManager: SessionManager,
    roomManager: LiveKitRoomManager = new LiveKitRoomManager(),
  ) {
    this.sessionManager = sessionManager;
    this.roomManager = roomManager;
  }

  getVoiceAgent(sessionId: string): VoiceAgent {
    let agent = this.voiceAgents.get(sessionId);
    if (!agent) {
      agent = new VoiceAgent({
        sessionId,
        sessionManager: this.sessionManager,
        roomManager: this.roomManager,
        sttEngine: createDefaultSttEngine(),
      });
      this.voiceAgents.set(sessionId, agent);
    }
    return agent;
  }

  async createToken(sessionId: string, req: Request): Promise<Response> {
    const session = this.sessionManager.get(sessionId);
    if (!session && sessionId !== "global") {
      return new Response(
        JSON.stringify({
          status: "error",
          error: {
            code: "SESSION_NOT_FOUND",
            message: `Session '${sessionId}' not found`,
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

    try {
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        body = {};
      }

      const participantName = body.participantName || "Crucible User";
      const tokenResult = this.roomManager.createSessionToken(sessionId, {
        participantName,
        ttlSeconds: body.ttlSeconds ?? 3600,
      });

      // Ensure server-side voice agent is initialized for room
      const agent = this.getVoiceAgent(sessionId);
      if (!agent.isConnected()) {
        agent.joinRoom().catch((err) => {
          logger.warn(
            { err, sessionId },
            "[VoiceRouteHandler] Background voice agent join error",
          );
        });
      }

      return new Response(
        JSON.stringify({
          status: "success",
          data: {
            token: tokenResult.token,
            wsUrl: tokenResult.wsUrl,
            httpUrl: tokenResult.httpUrl,
            roomName: tokenResult.roomName,
            participantIdentity: tokenResult.participantIdentity,
            expiresAt: tokenResult.expiresAt,
            agentIdentity: agent.getAgentIdentity(),
            agentState: agent.getState(),
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    } catch (err: any) {
      logger.error(
        { err, sessionId },
        "[VoiceRouteHandler] Failed to mint voice token",
      );
      return new Response(
        JSON.stringify({
          status: "error",
          error: {
            code: "TOKEN_MINTING_ERROR",
            message: err.message || "Failed to mint LiveKit access token",
          },
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }
  }

  async transcribeAudio(sessionId: string, req: Request): Promise<Response> {
    const session = this.sessionManager.get(sessionId);
    if (!session && sessionId !== "global") {
      return new Response(
        JSON.stringify({
          status: "error",
          error: {
            code: "SESSION_NOT_FOUND",
            message: `Session '${sessionId}' not found`,
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

    try {
      let body: any = {};
      const contentType = req.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        body = await req.json();
      } else {
        const arrayBuf = await req.arrayBuffer();
        body = {
          audioBuffer: arrayBuf,
          mimeType: contentType,
        };
      }

      if (!body.audioBase64 && !body.audioBuffer && !body.text) {
        return new Response(
          JSON.stringify({
            status: "error",
            error: {
              code: "MISSING_AUDIO_PAYLOAD",
              message: "Request must include 'audioBase64' or raw audio body",
            },
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }

      const agent = this.getVoiceAgent(sessionId);
      const result = await agent.processAudioInput({
        audioBase64: body.audioBase64,
        audioBuffer: body.audioBuffer,
        mimeType: body.mimeType || "audio/wav",
        language: body.language,
      });

      return new Response(
        JSON.stringify({
          status: "success",
          data: {
            transcript: result.transcript,
            durationMs: result.durationMs,
            forwarded: result.forwarded,
            agentState: agent.getState(),
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    } catch (err: any) {
      logger.error(
        { err, sessionId },
        "[VoiceRouteHandler] STT audio processing failed",
      );
      return new Response(
        JSON.stringify({
          status: "error",
          error: {
            code: "STT_PROCESSING_ERROR",
            message: err.message || "Failed to transcribe audio payload",
          },
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }
  }

  async getSessionVoiceStatus(sessionId: string): Promise<Response> {
    const session = this.sessionManager.get(sessionId);
    if (!session) {
      return new Response(
        JSON.stringify({
          status: "error",
          error: {
            code: "SESSION_NOT_FOUND",
            message: `Session '${sessionId}' not found`,
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

    const agent = this.voiceAgents.get(sessionId);
    const roomName = this.roomManager.getRoomNameForSession(sessionId);
    const liveness = await this.roomManager.checkServerLiveness(1000);

    return new Response(
      JSON.stringify({
        status: "success",
        data: {
          sessionId,
          roomName,
          agentState: agent ? agent.getState() : "idle",
          agentConnected: agent ? agent.isConnected() : false,
          serverReachable: liveness.reachable,
          serverLatencyMs: liveness.latencyMs,
          serverConfig: {
            wsUrl: this.roomManager.getConfig().wsUrl,
            httpUrl: this.roomManager.getConfig().httpUrl,
          },
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }

  async getGlobalVoiceStatus(): Promise<Response> {
    const liveness = await this.roomManager.checkServerLiveness(1000);
    const activeRooms = this.roomManager.getActiveRooms();

    return new Response(
      JSON.stringify({
        status: "success",
        data: {
          serverReachable: liveness.reachable,
          serverLatencyMs: liveness.latencyMs,
          activeRoomCount: activeRooms.length,
          activeRooms,
          activeVoiceAgents: this.voiceAgents.size,
          config: {
            wsUrl: this.roomManager.getConfig().wsUrl,
            httpUrl: this.roomManager.getConfig().httpUrl,
          },
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }
}
