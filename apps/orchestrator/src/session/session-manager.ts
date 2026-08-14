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
import { SessionRepository } from "../persistence/postgres/session-repository";
import { RunRepository } from "../persistence/postgres/run-repository";
import { RedisSessionStore } from "../persistence/redis/session-store";
import { logger } from "../observability/logger";
import { getErrorReporter } from "../observability/error-reporter";

export class SessionManager extends EventEmitter {
  private sessions = new Map<SessionId, Session>();
  private config: SessionManagerConfig;
  private sessionRepository?: SessionRepository;
  private runRepository?: RunRepository;
  private redisStore?: RedisSessionStore;
  private autoPersist: boolean;

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

    this.sessionRepository = config.sessionRepository;
    this.runRepository = config.runRepository;
    this.redisStore = config.redisStore;
    this.autoPersist = config.autoPersist ?? true;
  }

  private createSessionInternal(options: CreateSessionOptions = {}): Session {
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
      guardrails: options.guardrails || this.config.defaultGuardrails,
      metadata: options.metadata,
      onHumanApprovalRequired: options.onHumanApprovalRequired,
    });

    this.bindSessionEvents(session);
    this.sessions.set(sessionId, session);
    return session;
  }

  createSession(options: CreateSessionOptions = {}): Session {
    const session = this.createSessionInternal(options);

    // Persist to Postgres & Redis asynchronously
    if (this.autoPersist) {
      this.persistSessionCreation(session, options).catch((err) => {
        logger.error(
          { err, sessionId: session.id },
          "[SessionManager] Failed to persist session creation",
        );
      });
    }

    this.emit("sessionCreated", session.getSummary());
    return session;
  }

  async createSessionAsync(
    options: CreateSessionOptions = {},
  ): Promise<Session> {
    const session = this.createSessionInternal(options);
    if (this.autoPersist) {
      await this.persistSessionCreation(session, options);
    }
    this.emit("sessionCreated", session.getSummary());
    return session;
  }

  private async persistSessionCreation(
    session: Session,
    options: CreateSessionOptions,
  ): Promise<void> {
    if (this.sessionRepository) {
      await this.sessionRepository.createSession({
        id: session.id,
        title: session.title,
        systemPrompt: options.systemPrompt || this.config.defaultSystemPrompt,
        modelSlug: options.model || this.config.defaultModel,
        metadata: session.metadata,
        status: session.getStatus(),
        agentState: session.getState(),
      });
    }

    if (this.runRepository) {
      await this.runRepository.appendEvent(session.id, "SESSION_CREATED", {
        title: session.title,
        modelSlug: options.model || this.config.defaultModel,
        createdAt: session.createdAt,
      });
    }

    if (this.redisStore) {
      await this.redisStore.setHotState(session.id, {
        sessionId: session.id,
        status: session.getStatus(),
        agentState: session.getState(),
        title: session.title || null,
        modelSlug: options.model || this.config.defaultModel || "default",
        turnCount: 0,
        lastActiveAt: Date.now(),
        metadata: session.metadata,
      });
    }
  }

  private bindSessionEvents(session: Session): void {
    session.on("stateChange", (current, prev) => {
      this.emit("sessionStateChange", session.id, current);

      if (this.autoPersist) {
        if (this.runRepository) {
          this.runRepository
            .appendEvent(session.id, "STEP_TRANSITION", {
              from: prev,
              to: current,
              timestamp: new Date(),
            })
            .catch(() => {});
        }
        if (this.sessionRepository) {
          this.sessionRepository
            .updateSession(session.id, { agentState: current })
            .catch(() => {});
        }
        if (this.redisStore) {
          this.redisStore
            .setHotState(session.id, {
              sessionId: session.id,
              status: session.getStatus(),
              agentState: current,
              title: session.title || null,
              modelSlug:
                (session.getSummary().metadata?.model as string) || "default",
              turnCount: session.getSummary().turnCount,
              lastActiveAt: Date.now(),
            })
            .catch(() => {});
        }
      }
    });

    session.on("statusChange", (status) => {
      if (this.autoPersist) {
        if (this.runRepository) {
          this.runRepository
            .appendEvent(session.id, "SESSION_STATUS_CHANGED", {
              status,
              timestamp: new Date(),
            })
            .catch(() => {});
        }
        if (this.sessionRepository) {
          this.sessionRepository
            .updateSession(session.id, { status })
            .catch(() => {});
        }
      }
    });

    session.on("turnCompleted", (turnData: any) => {
      // Background async fallback if prompt() was called directly without dispatch()
      if (this.autoPersist) {
        this.persistTurnFromEvent(session, turnData).catch((err) => {
          logger.error(
            { err, sessionId: session.id },
            "[SessionManager] Failed to persist turn from event",
          );
        });
      }
    });

    session.on("error", (error) => {
      this.emit("sessionError", session.id, error);
      if (this.autoPersist && this.runRepository) {
        this.runRepository
          .appendEvent(session.id, "ERROR_ENCOUNTERED", {
            error: error.message || error,
            timestamp: new Date(),
          })
          .catch(() => {});
      }
    });
  }

  /**
   * Restores all persisted sessions and past turns across orchestrator restarts
   */
  async restoreFromPersistence(): Promise<number> {
    if (!this.sessionRepository) {
      return 0;
    }

    try {
      const persistedSessions = await this.sessionRepository.loadAllSessions();
      let restoredCount = 0;

      for (const record of persistedSessions) {
        if (this.sessions.has(record.id)) {
          continue;
        }

        const session = new Session({
          sessionId: record.id,
          title: record.title || undefined,
          systemPrompt: record.systemPrompt || this.config.defaultSystemPrompt,
          model: record.modelSlug || this.config.defaultModel,
          provider: this.config.defaultProvider,
          tools: this.config.defaultTools,
          metadata: (record.metadata as Record<string, unknown>) || {},
        });

        // Reconstruct messages from persisted turns
        const messages: any[] = [];
        for (const turn of record.turns) {
          if (turn.thought || turn.modelOutput) {
            messages.push({
              role: "assistant",
              content: turn.modelOutput || undefined,
              thought: turn.thought || undefined,
              toolCalls: turn.toolCalls.map((tc) => ({
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
              })),
            });
          }
        }

        session.restoreState({
          status: record.status as any,
          turnCount: record.turns.length,
          messages,
          updatedAt: record.updatedAt,
        });

        this.bindSessionEvents(session);
        this.sessions.set(record.id, session);
        restoredCount++;
      }

      logger.info(
        { restoredCount, totalInDb: persistedSessions.length },
        "[SessionManager] Restored sessions from PostgreSQL persistence",
      );
      return restoredCount;
    } catch (err: any) {
      logger.error(
        { err },
        "[SessionManager] Failed to restore sessions from PostgreSQL",
      );
      getErrorReporter().captureAgentError(err, {
        component: "SessionManager",
        alert: "CRUCIBLE_DATABASE_RESTORE_FAILURE_ALERT",
      });
      return 0;
    }
  }

  get(id: SessionId): Session | undefined {
    return this.sessions.get(id);
  }

  getSession(id: SessionId): Session | undefined {
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

    if (this.autoPersist) {
      if (this.sessionRepository) {
        this.sessionRepository.deleteSession(id).catch(() => {});
      }
      if (this.redisStore) {
        this.redisStore.deleteHotState(id).catch(() => {});
      }
    }

    this.emit("sessionDeleted", id);
    return true;
  }

  clear(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
  }

  private async persistTurnFromEvent(
    session: Session,
    turnData: any,
  ): Promise<void> {
    if (this.sessionRepository && turnData.turnNumber) {
      const toolCalls =
        turnData.history?.flatMap(
          (step: any) =>
            step.actions?.map((tc: any) => {
              const obs = step.observations?.find((o: any) => o.id === tc.id);
              return {
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments || {},
                status: obs
                  ? obs.status === "error"
                    ? "ERROR"
                    : "SUCCESS"
                  : "SUCCESS",
                stdout: obs?.stdout,
                stderr: obs?.stderr,
                output: obs?.output,
                error: obs?.error,
              };
            }) || [],
        ) || [];

      await this.sessionRepository.recordTurn(session.id, turnData.turnNumber, {
        thought: turnData.thought,
        modelOutput: turnData.modelOutput,
        durationMs: turnData.durationMs,
        toolCalls,
      });
    }

    if (this.runRepository && turnData.turnNumber) {
      await this.runRepository.appendEvent(session.id, "MODEL_COMPLETION", {
        turnNumber: turnData.turnNumber,
        modelOutput: turnData.modelOutput,
        thought: turnData.thought,
        error: turnData.error,
      });
    }

    if (this.redisStore && turnData.turnNumber) {
      await this.redisStore.setHotState(session.id, {
        sessionId: session.id,
        status: session.getStatus(),
        agentState: session.getState(),
        title: session.title || null,
        modelSlug:
          (session.getSummary().metadata?.model as string) || "default",
        turnCount: turnData.turnNumber,
        lastActiveAt: Date.now(),
      });
    }
  }

  async dispatch(id: SessionId, prompt: string): Promise<AgentLoopResult> {
    const session = this.getOrThrow(id);
    const result = await session.prompt(prompt);
    if (this.autoPersist) {
      await this.persistTurnFromEvent(session, {
        turnNumber: session.getSummary().turnCount,
        thought: result.history?.[result.history.length - 1]?.thought,
        modelOutput: result.finalResponse,
        history: result.history,
        error: result.error,
      });
    }
    return result;
  }
}
