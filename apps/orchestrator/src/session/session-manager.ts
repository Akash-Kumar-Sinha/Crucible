import { EventEmitter } from "node:events";
import { OpenRouterProvider } from "../provider/openrouter";
import { ToolRegistry } from "../tools/registry";
import { Session } from "./session";
import type {
  CreateSessionOptions,
  SessionId,
  SessionManagerConfig,
  SessionSummary,
} from "./types";
import type { AgentLoopResult } from "../agent/loop";

export class SessionManager extends EventEmitter {
  private sessions = new Map<SessionId, Session>();
  private config: SessionManagerConfig;

  constructor(config: SessionManagerConfig = {}) {
    super();
    this.config = {
      defaultProvider: config.defaultProvider || new OpenRouterProvider(),
      defaultTools: config.defaultTools || new ToolRegistry(),
      defaultSystemPrompt: config.defaultSystemPrompt,
      defaultMaxSteps: config.defaultMaxSteps,
      defaultModel: config.defaultModel,
      maxConcurrentSessions: config.maxConcurrentSessions,
    };
  }

  createSession(options: CreateSessionOptions = {}): Session {
    if (
      this.config.maxConcurrentSessions &&
      this.sessions.size >= this.config.maxConcurrentSessions
    ) {
      throw new Error(
        `Session limit reached: Maximum of ${this.config.maxConcurrentSessions} concurrent sessions allowed.`,
      );
    }

    const sessionId =
      options.sessionId ||
      `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    if (this.sessions.has(sessionId)) {
      throw new Error(
        `Session with id "${sessionId}" already exists in SessionManager.`,
      );
    }

    const session = new Session({
      sessionId,
      title: options.title,
      systemPrompt: options.systemPrompt || this.config.defaultSystemPrompt,
      model: options.model || this.config.defaultModel,
      temperature: options.temperature,
      maxSteps: options.maxSteps || this.config.defaultMaxSteps,
      provider: options.provider || this.config.defaultProvider,
      tools: options.tools || this.config.defaultTools,
      metadata: options.metadata,
      onHumanApprovalRequired: options.onHumanApprovalRequired,
    });

    this.bindSessionEvents(session);
    this.sessions.set(sessionId, session);

    this.emit("sessionCreated", session.getSummary());
    return session;
  }

  private bindSessionEvents(session: Session): void {
    session.on("stateChange", (current) => {
      this.emit("sessionStateChange", session.id, current);
    });

    session.on("error", (error) => {
      this.emit("sessionError", session.id, error);
    });
  }

  get(id: SessionId): Session | undefined {
    return this.sessions.get(id);
  }

  getOrThrow(id: SessionId): Session {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session with id "${id}" not found.`);
    }
    return session;
  }

  has(id: SessionId): boolean {
    return this.sessions.has(id);
  }

  list(): SessionSummary[] {
    return Array.from(this.sessions.values()).map((s) => s.getSummary());
  }

  getAll(): Session[] {
    return Array.from(this.sessions.values());
  }

  count(): number {
    return this.sessions.size;
  }

  delete(id: SessionId): boolean {
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }

    session.dispose();
    this.sessions.delete(id);
    this.emit("sessionDeleted", id);
    return true;
  }

  clear(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
  }

  async dispatch(id: SessionId, prompt: string): Promise<AgentLoopResult> {
    const session = this.getOrThrow(id);
    return session.prompt(prompt);
  }
}
