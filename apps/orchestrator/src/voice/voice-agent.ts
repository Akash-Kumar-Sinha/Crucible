import { EventEmitter } from "node:events";
import type { SessionManager } from "../session/session-manager";
import type {
  ISttEngine,
  VoiceAgentState,
  SttTranscriptionRequest,
  SttTranscriptionResult,
  VoiceAgentDataEvent,
} from "./types";
import { LiveKitRoomManager } from "./livekit-room-manager";
import { createDefaultSttEngine } from "./stt-engine";
import { getErrorReporter } from "../observability/error-reporter";
import { logger } from "../observability/logger";

export interface VoiceAgentOptions {
  sessionId: string;
  sessionManager: SessionManager;
  roomManager?: LiveKitRoomManager;
  sttEngine?: ISttEngine;
  agentIdentity?: string;
  autoJoin?: boolean;
}

export class VoiceAgent extends EventEmitter {
  readonly sessionId: string;
  readonly roomName: string;
  readonly agentIdentity: string;

  private sessionManager: SessionManager;
  private roomManager: LiveKitRoomManager;
  private sttEngine: ISttEngine;
  private state: VoiceAgentState = "idle";
  private isJoined = false;

  constructor(options: VoiceAgentOptions) {
    super();
    this.sessionId = options.sessionId;
    this.sessionManager = options.sessionManager;
    this.roomManager = options.roomManager || new LiveKitRoomManager();
    this.sttEngine = options.sttEngine || createDefaultSttEngine();
    this.roomName = this.roomManager.getRoomNameForSession(this.sessionId);
    this.agentIdentity = options.agentIdentity || `agent_stt_${this.sessionId}`;

    if (options.autoJoin) {
      this.joinRoom().catch((err) => {
        logger.error(
          { err, sessionId: this.sessionId },
          "[VoiceAgent] Auto-join failed",
        );
      });
    }
  }

  getState(): VoiceAgentState {
    return this.state;
  }

  getRoomName(): string {
    return this.roomName;
  }

  getAgentIdentity(): string {
    return this.agentIdentity;
  }

  isConnected(): boolean {
    return this.isJoined;
  }

  private setState(nextState: VoiceAgentState) {
    const prevState = this.state;
    this.state = nextState;
    this.emit("stateChange", { from: prevState, to: nextState });

    const event: VoiceAgentDataEvent = {
      type: "agent_state",
      state: nextState,
      sessionId: this.sessionId,
      roomName: this.roomName,
    };
    this.emit("dataEvent", event);
  }

  async joinRoom(): Promise<{ success: boolean; token: string }> {
    this.setState("connecting");

    try {
      // 1. Verify server connectivity before issuing token
      const liveness = await this.roomManager.checkServerLiveness(1500);
      if (!liveness.reachable) {
        // Emit LiveKit server unreachable alert
        const errorReporter = getErrorReporter();
        errorReporter.recordLiveKitUnreachableAlert({
          sessionId: this.sessionId,
          wsUrl: this.roomManager.getConfig().wsUrl,
          httpUrl: this.roomManager.getConfig().httpUrl,
          reason: liveness.error || "LiveKit server connection failed",
        });

        logger.warn(
          { sessionId: this.sessionId, error: liveness.error },
          "[VoiceAgent] Self-hosted LiveKit server is unreachable; proceeding in direct voice adapter mode",
        );
      }

      // 2. Mint server-side agent participant token
      const tokenResult = this.roomManager.createAgentToken(this.sessionId, {
        agentIdentity: this.agentIdentity,
      });

      this.isJoined = true;
      this.setState("listening");

      logger.info(
        {
          sessionId: this.sessionId,
          roomName: this.roomName,
          agentIdentity: this.agentIdentity,
        },
        "[VoiceAgent] Self-hosted voice agent initialized and listening in room",
      );

      return { success: true, token: tokenResult.token };
    } catch (err: any) {
      this.setState("error");
      const errorReporter = getErrorReporter();
      errorReporter.recordVoiceAgentJoinFailureAlert({
        sessionId: this.sessionId,
        roomName: this.roomName,
        agentIdentity: this.agentIdentity,
        reason: err.message || "Failed to initialize or join room",
      });

      throw err;
    }
  }

  /**
   * Adapter pattern: Transcribes raw audio buffer/base64 via STT engine,
   * adapts transcript into standard message payload, and forwards to SessionManager.
   */
  async processAudioInput(
    request: Omit<SttTranscriptionRequest, "sessionId">,
  ): Promise<{
    transcript: string;
    durationMs: number;
    forwarded: boolean;
  }> {
    if (this.state !== "listening" && this.state !== "idle") {
      logger.debug(
        { state: this.state, sessionId: this.sessionId },
        "[VoiceAgent] Processing audio while in busy state",
      );
    }

    this.setState("transcribing");

    let sttResult: SttTranscriptionResult;
    try {
      sttResult = await this.sttEngine.transcribe({
        ...request,
        sessionId: this.sessionId,
      });
    } catch (err: any) {
      this.setState("error");
      const errorReporter = getErrorReporter();
      errorReporter.recordVoiceSttFailureAlert({
        sessionId: this.sessionId,
        sttEngine: this.sttEngine.name,
        reason: err.message || "STT transcription failed or timed out",
      });

      // Recover state back to listening
      setTimeout(() => {
        if (this.state === "error") {
          this.setState(this.isJoined ? "listening" : "idle");
        }
      }, 1000);

      throw err;
    }

    const transcriptText = sttResult.text.trim();
    if (!transcriptText) {
      this.setState(this.isJoined ? "listening" : "idle");
      return {
        transcript: "",
        durationMs: sttResult.durationMs,
        forwarded: false,
      };
    }

    // Emit live transcript data event
    const transcriptEvent: VoiceAgentDataEvent = {
      type: "transcript",
      role: "user",
      text: transcriptText,
      isFinal: true,
      confidence: sttResult.confidence,
      timestamp: Date.now(),
    };
    this.emit("dataEvent", transcriptEvent);

    // Forward transcript into Session message path
    this.setState("forwarding");
    let forwarded = false;

    try {
      const session = this.sessionManager.get(this.sessionId);
      if (session) {
        // Forward through the exact same message path text input uses
        await session.prompt(transcriptText);
        forwarded = true;
        logger.info(
          { sessionId: this.sessionId, transcript: transcriptText },
          "[VoiceAgent] Transcribed voice command forwarded into Session message path",
        );
      } else {
        logger.warn(
          { sessionId: this.sessionId },
          "[VoiceAgent] Session not found for forwarding voice transcript",
        );
      }
    } catch (err: any) {
      logger.error(
        { err, sessionId: this.sessionId },
        "[VoiceAgent] Failed to forward transcript into session message loop",
      );
      this.setState("error");
      throw err;
    } finally {
      this.setState(this.isJoined ? "listening" : "idle");
    }

    return {
      transcript: transcriptText,
      durationMs: sttResult.durationMs,
      forwarded,
    };
  }

  async leaveRoom(): Promise<void> {
    this.isJoined = false;
    this.setState("disconnected");
    this.setState("idle");
    this.removeAllListeners();
  }
}
