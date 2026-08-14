import Redis, { type RedisOptions } from "ioredis";
import { logger } from "../../observability/logger";
import { getErrorReporter } from "../../observability/error-reporter";

export interface HotSessionState {
  sessionId: string;
  status: string;
  agentState: string;
  title: string | null;
  modelSlug: string;
  turnCount: number;
  activeToolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  streamingThought?: string;
  lastActiveAt: number;
  metadata?: Record<string, unknown>;
}

export interface RedisSessionStoreConfig {
  redisUrl?: string;
  keyPrefix?: string;
  defaultTtlSeconds?: number;
  enableOfflineQueue?: boolean;
  lazyConnect?: boolean;
}

/**
 * Fast Hot Session State Store via Redis
 * Stores active running session states with sub-millisecond read/write latency and TTLs.
 */
export class RedisSessionStore {
  private client: Redis | null = null;
  private subClient: Redis | null = null;
  private readonly keyPrefix: string;
  private readonly defaultTtlSeconds: number;
  private readonly redisUrl: string;
  private isConnected = false;

  constructor(config: RedisSessionStoreConfig = {}) {
    this.keyPrefix = config.keyPrefix || "crucible:session:";
    this.defaultTtlSeconds = config.defaultTtlSeconds || 86400; // 24 hours
    this.redisUrl =
      config.redisUrl || process.env.REDIS_URL || "redis://127.0.0.1:6379";
  }

  private getClient(): Redis {
    if (!this.client) {
      this.client = new Redis(this.redisUrl, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => {
          if (times > 3) return null;
          return Math.min(times * 100, 1000);
        },
      });

      this.client.on("connect", () => {
        this.isConnected = true;
        logger.debug("[RedisSessionStore] Connected to Redis");
      });

      this.client.on("error", (err) => {
        this.isConnected = false;
        logger.warn({ err }, "[RedisSessionStore] Redis connection error");
      });

      this.client.on("close", () => {
        this.isConnected = false;
      });
    }

    return this.client;
  }

  private getSessionKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  async setHotState(
    sessionId: string,
    state: HotSessionState,
    ttlSeconds: number = this.defaultTtlSeconds,
  ): Promise<boolean> {
    try {
      const client = this.getClient();
      if (client.status === "wait") {
        await client.connect();
      }

      const key = this.getSessionKey(sessionId);
      const serialized = JSON.stringify(state);

      if (ttlSeconds > 0) {
        await client.setex(key, ttlSeconds, serialized);
      } else {
        await client.set(key, serialized);
      }

      return true;
    } catch (err: any) {
      logger.warn(
        { err, sessionId },
        "[RedisSessionStore] Failed to write hot session state to Redis (falling back to memory)",
      );
      return false;
    }
  }

  async getHotState(sessionId: string): Promise<HotSessionState | null> {
    try {
      const client = this.getClient();
      if (client.status === "wait") {
        await client.connect();
      }

      const key = this.getSessionKey(sessionId);
      const data = await client.get(key);

      if (!data) return null;
      return JSON.parse(data) as HotSessionState;
    } catch (err: any) {
      logger.warn(
        { err, sessionId },
        "[RedisSessionStore] Failed to read hot session state from Redis",
      );
      return null;
    }
  }

  async deleteHotState(sessionId: string): Promise<boolean> {
    try {
      const client = this.getClient();
      if (client.status === "wait") {
        await client.connect();
      }

      const key = this.getSessionKey(sessionId);
      const deleted = await client.del(key);
      return deleted > 0;
    } catch (err: any) {
      logger.warn(
        { err, sessionId },
        "[RedisSessionStore] Failed to delete hot session state from Redis",
      );
      return false;
    }
  }

  async listActiveSessionIds(): Promise<string[]> {
    try {
      const client = this.getClient();
      if (client.status === "wait") {
        await client.connect();
      }

      const keys = await client.keys(`${this.keyPrefix}*`);
      return keys.map((k) => k.replace(this.keyPrefix, ""));
    } catch (err: any) {
      logger.warn(
        { err },
        "[RedisSessionStore] Failed to list active session IDs from Redis",
      );
      return [];
    }
  }

  async checkHealth(): Promise<{
    ok: boolean;
    latencyMs: number;
    error?: string;
  }> {
    const t0 = performance.now();
    try {
      const client = this.getClient();
      if (client.status === "wait") {
        await client.connect();
      }

      const pong = await client.ping();
      const latencyMs = Math.round(performance.now() - t0);
      return { ok: pong === "PONG", latencyMs };
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - t0);
      return { ok: false, latencyMs, error: err.message };
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
      this.client = null;
    }

    if (this.subClient) {
      try {
        await this.subClient.quit();
      } catch {
        this.subClient.disconnect();
      }
      this.subClient = null;
    }

    this.isConnected = false;
  }
}
