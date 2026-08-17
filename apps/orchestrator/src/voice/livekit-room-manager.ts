import { createHmac, randomUUID } from "node:crypto";
import type {
  LiveKitConfig,
  VoiceTokenOptions,
  VoiceTokenResult,
  VideoGrant,
} from "./types";
import { logger } from "../observability/logger";

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64").toString("utf8");
}

export function mintLiveKitJwt(
  options: VoiceTokenOptions,
  config: { apiKey: string; apiSecret: string },
): { token: string; expiresAt: number } {
  const nowSec = Math.floor(Date.now() / 1000);
  const ttlSec = options.ttlSeconds ?? 3600;
  const expiresAt = nowSec + ttlSec;

  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const videoGrant: VideoGrant = {
    room: options.roomName,
    roomJoin: true,
    canPublish: options.grants?.canPublish ?? true,
    canSubscribe: options.grants?.canSubscribe ?? true,
    canPublishData: options.grants?.canPublishData ?? true,
    roomAdmin: options.isAgent === true || options.grants?.roomAdmin === true,
    agent: options.isAgent === true,
    ...options.grants,
  };

  const payload: Record<string, unknown> = {
    iss: config.apiKey,
    sub: options.participantIdentity,
    name: options.participantName ?? options.participantIdentity,
    iat: nowSec,
    nbf: nowSec - 5,
    exp: expiresAt,
    jti: randomUUID(),
    video: videoGrant,
  };

  if (options.metadata) {
    payload.metadata = JSON.stringify(options.metadata);
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  const signature = createHmac("sha256", config.apiSecret)
    .update(signatureInput)
    .digest();
  const encodedSignature = base64UrlEncode(signature);

  return {
    token: `${signatureInput}.${encodedSignature}`,
    expiresAt,
  };
}

export function verifyLiveKitJwt(
  token: string,
  apiSecret: string,
): { valid: boolean; payload?: Record<string, unknown>; error?: string } {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return { valid: false, error: "Malformed JWT token format" };
    }
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const signatureInput = `${encodedHeader}.${encodedPayload}`;

    const expectedSignature = base64UrlEncode(
      createHmac("sha256", apiSecret).update(signatureInput).digest(),
    );

    if (encodedSignature !== expectedSignature) {
      return { valid: false, error: "Invalid signature verification" };
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < nowSec) {
      return { valid: false, error: "Token has expired" };
    }

    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err.message || "Failed to verify token" };
  }
}

export class LiveKitRoomManager {
  private config: LiveKitConfig;
  private activeRooms = new Map<
    string,
    {
      roomName: string;
      sessionId: string;
      createdAt: number;
      participants: Set<string>;
    }
  >();

  constructor(config?: Partial<LiveKitConfig>) {
    const apiKey =
      config?.apiKey || process.env.LIVEKIT_API_KEY || "crucible_dev_key";
    const apiSecret =
      config?.apiSecret ||
      process.env.LIVEKIT_API_SECRET ||
      "crucible_livekit_secret_key_32_chars_long";
    const wsUrl =
      config?.wsUrl ||
      process.env.LIVEKIT_URL ||
      process.env.NEXT_PUBLIC_LIVEKIT_URL ||
      "ws://127.0.0.1:7880";
    const httpUrl =
      config?.httpUrl ||
      process.env.LIVEKIT_HTTP_URL ||
      wsUrl.replace(/^ws/, "http");

    this.config = { apiKey, apiSecret, wsUrl, httpUrl };
  }

  getConfig(): LiveKitConfig {
    return { ...this.config };
  }

  getRoomNameForSession(sessionId: string): string {
    return `crucible_session_${sessionId}`;
  }

  createSessionToken(
    sessionId: string,
    options?: {
      participantIdentity?: string;
      participantName?: string;
      ttlSeconds?: number;
    },
  ): VoiceTokenResult {
    const roomName = this.getRoomNameForSession(sessionId);
    const participantIdentity =
      options?.participantIdentity ||
      `user_${sessionId}_${Math.random().toString(36).slice(2, 7)}`;

    const { token, expiresAt } = mintLiveKitJwt(
      {
        roomName,
        participantIdentity,
        participantName: options?.participantName || "Crucible User",
        isAgent: false,
        ttlSeconds: options?.ttlSeconds ?? 3600,
        grants: {
          room: roomName,
          roomJoin: true,
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
        },
      },
      this.config,
    );

    this.trackRoomParticipant(roomName, sessionId, participantIdentity);

    logger.debug(
      { sessionId, roomName, participantIdentity },
      "[LiveKitRoomManager] Minted client voice access token",
    );

    return {
      token,
      wsUrl: this.config.wsUrl,
      httpUrl: this.config.httpUrl,
      roomName,
      participantIdentity,
      expiresAt,
    };
  }

  createAgentToken(
    sessionId: string,
    options?: {
      agentIdentity?: string;
      ttlSeconds?: number;
    },
  ): VoiceTokenResult {
    const roomName = this.getRoomNameForSession(sessionId);
    const participantIdentity =
      options?.agentIdentity || `agent_stt_${sessionId}`;

    const { token, expiresAt } = mintLiveKitJwt(
      {
        roomName,
        participantIdentity,
        participantName: "Crucible Voice Agent (STT)",
        isAgent: true,
        ttlSeconds: options?.ttlSeconds ?? 7200,
        grants: {
          room: roomName,
          roomJoin: true,
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
          roomAdmin: true,
        },
      },
      this.config,
    );

    this.trackRoomParticipant(roomName, sessionId, participantIdentity);

    logger.debug(
      { sessionId, roomName, participantIdentity },
      "[LiveKitRoomManager] Minted voice agent access token",
    );

    return {
      token,
      wsUrl: this.config.wsUrl,
      httpUrl: this.config.httpUrl,
      roomName,
      participantIdentity,
      expiresAt,
    };
  }

  private trackRoomParticipant(
    roomName: string,
    sessionId: string,
    participantIdentity: string,
  ) {
    let room = this.activeRooms.get(roomName);
    if (!room) {
      room = {
        roomName,
        sessionId,
        createdAt: Date.now(),
        participants: new Set(),
      };
      this.activeRooms.set(roomName, room);
    }
    room.participants.add(participantIdentity);
  }

  getActiveRooms(): Array<{
    roomName: string;
    sessionId: string;
    participantCount: number;
    createdAt: number;
  }> {
    return Array.from(this.activeRooms.values()).map((r) => ({
      roomName: r.roomName,
      sessionId: r.sessionId,
      participantCount: r.participants.size,
      createdAt: r.createdAt,
    }));
  }

  async checkServerLiveness(timeoutMs = 2000): Promise<{
    reachable: boolean;
    latencyMs: number;
    status?: number;
    error?: string;
  }> {
    const t0 = performance.now();
    try {
      const url = `${this.config.httpUrl}/`;
      const res = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Math.round(performance.now() - t0);
      const reachable = res.status === 200 || res.status === 404;
      return { reachable, latencyMs, status: res.status };
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - t0);
      return {
        reachable: false,
        latencyMs,
        error: err.message || "Failed to reach LiveKit server",
      };
    }
  }
}
