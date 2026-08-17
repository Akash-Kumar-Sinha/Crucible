import { z } from "zod";

export const VideoGrantSchema = z.object({
  room: z.string().optional(),
  roomJoin: z.boolean().optional(),
  roomList: z.boolean().optional(),
  roomRecord: z.boolean().optional(),
  roomAdmin: z.boolean().optional(),
  roomCreate: z.boolean().optional(),
  canPublish: z.boolean().optional(),
  canSubscribe: z.boolean().optional(),
  canPublishData: z.boolean().optional(),
  canUpdateOwnMetadata: z.boolean().optional(),
  ingressAdmin: z.boolean().optional(),
  hidden: z.boolean().optional(),
  recorder: z.boolean().optional(),
  agent: z.boolean().optional(),
});

export type VideoGrant = z.infer<typeof VideoGrantSchema>;

export interface VoiceTokenOptions {
  roomName: string;
  participantIdentity: string;
  participantName?: string;
  isAgent?: boolean;
  ttlSeconds?: number;
  metadata?: Record<string, unknown>;
  grants?: Partial<VideoGrant>;
}

export interface VoiceTokenResult {
  token: string;
  wsUrl: string;
  httpUrl: string;
  roomName: string;
  participantIdentity: string;
  expiresAt: number;
}

export interface LiveKitConfig {
  apiKey: string;
  apiSecret: string;
  wsUrl: string;
  httpUrl: string;
}

export type VoiceAgentState =
  | "idle"
  | "connecting"
  | "listening"
  | "transcribing"
  | "forwarding"
  | "error"
  | "disconnected";

export interface SttTranscriptionRequest {
  audioBuffer?: Buffer | Uint8Array | ArrayBuffer;
  audioBase64?: string;
  mimeType?: string;
  language?: string;
  sessionId: string;
  turnId?: number;
}

export interface SttTranscriptionResult {
  text: string;
  confidence?: number;
  durationMs: number;
  isFinal: boolean;
  language?: string;
}

export interface ISttEngine {
  readonly name: string;
  transcribe(request: SttTranscriptionRequest): Promise<SttTranscriptionResult>;
  isAvailable(): Promise<boolean>;
}

export const VoiceAgentDataEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("transcript"),
    role: z.enum(["user", "assistant"]),
    text: z.string(),
    isFinal: z.boolean(),
    confidence: z.number().optional(),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal("agent_state"),
    state: z.enum([
      "idle",
      "connecting",
      "listening",
      "transcribing",
      "forwarding",
      "error",
      "disconnected",
    ]),
    sessionId: z.string().optional(),
    roomName: z.string().optional(),
  }),
  z.object({
    type: z.literal("audio_level"),
    level: z.number().min(0).max(1),
    participantIdentity: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
    code: z.string().optional(),
  }),
]);

export type VoiceAgentDataEvent = z.infer<typeof VoiceAgentDataEventSchema>;
