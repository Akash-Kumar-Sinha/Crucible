import type {
  ISttEngine,
  SttTranscriptionRequest,
  SttTranscriptionResult,
} from "./types";
import { logger } from "../observability/logger";

export class MockSttEngine implements ISttEngine {
  readonly name = "mock_stt";
  private customResponses: string[] = [];

  constructor(responses?: string[]) {
    if (responses) {
      this.customResponses = [...responses];
    }
  }

  setResponses(responses: string[]) {
    this.customResponses = [...responses];
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async transcribe(
    request: SttTranscriptionRequest,
  ): Promise<SttTranscriptionResult> {
    const t0 = performance.now();
    let text = "What is the status of the repository?";

    if (this.customResponses.length > 0) {
      text = this.customResponses.shift()!;
    } else if (request.audioBase64) {
      try {
        const decoded = Buffer.from(request.audioBase64, "base64").toString(
          "utf8",
        );
        if (decoded.length > 3 && /^[\x20-\x7E\s]+$/.test(decoded)) {
          text = decoded;
        }
      } catch {
        // fallback to default mock text
      }
    }

    const durationMs = Math.max(1, Math.round(performance.now() - t0));
    return {
      text,
      confidence: 0.98,
      durationMs,
      isFinal: true,
      language: request.language || "en",
    };
  }
}

export class DeepgramSttEngine implements ISttEngine {
  readonly name = "deepgram_stt";
  private apiKey: string;
  private timeoutMs: number;

  constructor(options?: { apiKey?: string; timeoutMs?: number }) {
    this.apiKey = options?.apiKey || process.env.DEEPGRAM_API_KEY || "";
    this.timeoutMs = options?.timeoutMs ?? 10000;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async transcribe(
    request: SttTranscriptionRequest,
  ): Promise<SttTranscriptionResult> {
    if (!this.apiKey) {
      throw new Error("DEEPGRAM_API_KEY is not configured");
    }

    const t0 = performance.now();
    let audioBuffer: Buffer;

    if (request.audioBuffer) {
      audioBuffer = Buffer.from(request.audioBuffer as ArrayBuffer);
    } else if (request.audioBase64) {
      audioBuffer = Buffer.from(request.audioBase64, "base64");
    } else {
      throw new Error("Missing audio payload for STT transcription");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&language=${request.language || "en"}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Token ${this.apiKey}`,
          "Content-Type": request.mimeType || "audio/wav",
        },
        body: new Uint8Array(audioBuffer),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Deepgram API returned ${res.status}: ${errorText}`);
      }

      const json = await res.json();
      const transcript =
        json.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
      const confidence =
        json.results?.channels?.[0]?.alternatives?.[0]?.confidence ?? 0.95;

      return {
        text: transcript,
        confidence,
        durationMs: Math.round(performance.now() - t0),
        isFinal: true,
        language: request.language || "en",
      };
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === "AbortError") {
        throw new Error(
          `STT transcription timed out after ${this.timeoutMs}ms`,
          { cause: err },
        );
      }
      throw err;
    }
  }
}

export class WhisperSttEngine implements ISttEngine {
  readonly name = "whisper_stt";
  private apiKey: string;
  private endpointUrl: string;
  private timeoutMs: number;

  constructor(options?: {
    apiKey?: string;
    endpointUrl?: string;
    timeoutMs?: number;
  }) {
    this.apiKey =
      options?.apiKey ||
      process.env.OPENAI_API_KEY ||
      process.env.WHISPER_API_KEY ||
      "";
    this.endpointUrl =
      options?.endpointUrl ||
      process.env.WHISPER_ENDPOINT_URL ||
      "https://api.openai.com/v1/audio/transcriptions";
    this.timeoutMs = options?.timeoutMs ?? 15000;
  }

  async isAvailable(): Promise<boolean> {
    return (
      Boolean(this.apiKey) ||
      this.endpointUrl.includes("localhost") ||
      this.endpointUrl.includes("127.0.0.1")
    );
  }

  async transcribe(
    request: SttTranscriptionRequest,
  ): Promise<SttTranscriptionResult> {
    const t0 = performance.now();
    let audioBuffer: Buffer;

    if (request.audioBuffer) {
      audioBuffer = Buffer.from(request.audioBuffer as ArrayBuffer);
    } else if (request.audioBase64) {
      audioBuffer = Buffer.from(request.audioBase64, "base64");
    } else {
      throw new Error("Missing audio payload for STT transcription");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(audioBuffer)], {
        type: request.mimeType || "audio/wav",
      });
      formData.append("file", blob, "audio.wav");
      formData.append("model", "whisper-1");
      if (request.language) {
        formData.append("language", request.language);
      }

      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }

      const res = await fetch(this.endpointUrl, {
        method: "POST",
        headers,
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Whisper STT returned ${res.status}: ${errorText}`);
      }

      const json = await res.json();
      const text = json.text || "";

      return {
        text,
        confidence: 0.95,
        durationMs: Math.round(performance.now() - t0),
        isFinal: true,
        language: request.language || "en",
      };
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === "AbortError") {
        throw new Error(
          `Whisper STT transcription timed out after ${this.timeoutMs}ms`,
          { cause: err },
        );
      }
      throw err;
    }
  }
}

export function createDefaultSttEngine(): ISttEngine {
  if (process.env.DEEPGRAM_API_KEY) {
    logger.info("[STT] Using Deepgram Nova-2 STT engine");
    return new DeepgramSttEngine();
  }

  if (process.env.WHISPER_API_KEY || process.env.OPENAI_API_KEY) {
    logger.info("[STT] Using Whisper STT engine");
    return new WhisperSttEngine();
  }

  logger.debug(
    "[STT] No cloud STT key found, using default Mock/Direct STT engine",
  );
  return new MockSttEngine();
}
