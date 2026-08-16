import { EventEmitter } from "node:events";
import { OpenRouterProvider } from "../provider/openrouter";
import { ToolRegistry } from "../tools/registry";
import { Session } from "./session";
import { resolveSessionConfig } from "./session-config";
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
import {
  JobScheduler,
  type EnqueueJobOptions,
  type Job,
  type JobPriority,
  type QueueMetrics,
} from "../queue";
import { getBugHunterAuditLogger } from "../roles/bug-hunter-audit";
import { getPreviewManager } from "../preview/preview-manager";
import { synthesizeLivePreview } from "../preview/preview-synthesizer";

export class SessionManager extends EventEmitter {
  private sessions = new Map<SessionId, Session>();
  private config: SessionManagerConfig;
  private sessionRepository?: SessionRepository;
  private runRepository?: RunRepository;
  private redisStore?: RedisSessionStore;
  private autoPersist: boolean;
  private readonly maxConcurrentExecutions: number;
  private jobScheduler: JobScheduler;

  constructor(config: SessionManagerConfig = {}) {
    super();
    this.config = {
      defaultProvider: config.defaultProvider || new OpenRouterProvider(),
      defaultTools: config.defaultTools || new ToolRegistry(),
      defaultSystemPrompt: config.defaultSystemPrompt,
      defaultMaxSteps: config.defaultMaxSteps,
      defaultModel: config.defaultModel,
      maxConcurrentSessions: config.maxConcurrentSessions,
      maxConcurrentExecutions: config.maxConcurrentExecutions,
    };

    this.sessionRepository = config.sessionRepository;
    this.runRepository = config.runRepository;
    this.redisStore = config.redisStore;
    this.autoPersist = config.autoPersist ?? true;
    this.maxConcurrentExecutions =
      config.maxConcurrentExecutions ||
      Number(process.env.CRUCIBLE_MAX_CONCURRENT_EXECUTIONS || "4");

    this.jobScheduler =
      config.jobScheduler ||
      new JobScheduler({
        concurrency: this.maxConcurrentExecutions,
        ...config.queueConfig,
      });

    this.jobScheduler.registerHandler("session_run", async (job: Job) => {
      const session = this.getOrThrow(job.sessionId);
      const prompt = (job.payload.prompt as string) || "";
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
    });

    this.jobScheduler.on("jobDeadLetter", (job: Job, reason: string) => {
      const session = this.get(job.sessionId);
      if (session) {
        session.emit("error", {
          message: `Job ${job.id} dead-lettered: ${reason}`,
          details: { jobId: job.id, deadLetterReason: reason },
        });
      }
    });
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

    // TOOD: Session id is created here - if not provided
    const sessionId =
      options.sessionId ||
      `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    if (this.sessions.has(sessionId)) {
      throw new Error(
        `Session with id "${sessionId}" already exists in SessionManager.`,
      );
    }

    const resolvedConfig = resolveSessionConfig(
      {
        sessionId,
        ...options,
        provider: options.provider || this.config.defaultProvider,
        tools: options.tools || this.config.defaultTools,
        guardrails: options.guardrails || this.config.defaultGuardrails,
      },
      this.config,
    );

    const session = new Session(resolvedConfig);

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

    session.on("titleChange", (newTitle) => {
      this.emit("sessionUpdated", session.getSummary());

      if (this.autoPersist) {
        if (this.sessionRepository) {
          this.sessionRepository
            .updateSession(session.id, {
              title: newTitle,
              metadata: {
                ...session.metadata,
                messages: session.getMessages(),
              },
            })
            .catch(() => {});
        }
        if (this.redisStore) {
          this.redisStore
            .setHotState(session.id, {
              sessionId: session.id,
              status: session.getStatus(),
              agentState: session.getState(),
              title: newTitle,
              modelSlug:
                (session.getSummary().metadata?.model as string) || "default",
              turnCount: session.getSummary().turnCount,
              lastActiveAt: Date.now(),
              metadata: {
                ...session.metadata,
                messages: session.getMessages(),
              },
            })
            .catch(() => {});
        }
      }
    });

    session.on("message", (msg) => {
      this.emit("sessionMessage", session.id, msg);

      // Automatically synthesize live preview when assistant generates frontend code
      if (msg.role === "assistant" && msg.content) {
        try {
          const liveHtml = synthesizeLivePreview(msg.content, session.id);
          if (liveHtml) {
            getPreviewManager().setPreviewContent(session.id, liveHtml);
          }
        } catch {
          // Graceful fallback
        }
      }

      if (this.autoPersist) {
        if (this.sessionRepository) {
          this.sessionRepository
            .updateSession(session.id, {
              title: session.title,
              status: session.getStatus(),
              agentState: session.getState(),
              metadata: {
                ...session.metadata,
                messages: session.getMessages(),
              },
            })
            .catch(() => {});
        }
        if (this.redisStore) {
          this.redisStore
            .setHotState(session.id, {
              sessionId: session.id,
              status: session.getStatus(),
              agentState: session.getState(),
              title: session.title || null,
              modelSlug:
                (session.getSummary().metadata?.model as string) || "default",
              turnCount: session.getSummary().turnCount,
              lastActiveAt: Date.now(),
              metadata: {
                ...session.metadata,
                messages: session.getMessages(),
              },
            })
            .catch(() => {});
        }
      }
    });

    session.on("action", (actions) => {
      for (const act of actions) {
        if (act.name === "write_file" && act.arguments?.content) {
          try {
            const liveHtml = synthesizeLivePreview(
              act.arguments.content,
              session.id,
            );
            if (liveHtml) {
              getPreviewManager().setPreviewContent(session.id, liveHtml);
            }
          } catch {
            // Graceful fallback
          }
        }
      }
    });

    session.on("turnCompleted", (turnData: any) => {
      if (this.autoPersist) {
        this.persistTurnFromEvent(session, turnData).catch((err) => {
          logger.error(
            { err, sessionId: session.id },
            "[SessionManager] Failed to persist turn from event",
          );
        });
      }
    });

    session.on("interSessionMessage", (msg) => {
      this.emit("interSessionMessage", session.id, msg);
    });

    // Adversarial Sandbox Hardening: Bug Hunter Append-Only Cryptographic Audit Log
    if (
      session.getRole() === "bug_hunter" ||
      session.metadata?.role === "bug_hunter"
    ) {
      const auditLogger = getBugHunterAuditLogger();
      const squadId = (session.metadata?.squadId as string) || undefined;

      session.on("action", (actions) => {
        for (const act of actions) {
          auditLogger.recordAction({
            sessionId: session.id,
            squadId,
            action: act.name || "tool_call",
            input: act.arguments || {},
            tenantId: session.getTenantId(),
            namespace: session.getNamespace(),
          });
        }
      });

      session.on("observation", (observations) => {
        for (const obs of observations) {
          auditLogger.recordAction({
            sessionId: session.id,
            squadId,
            action: `${obs.name || "tool"}:observation`,
            input: { callId: obs.callId },
            output:
              typeof obs.output === "string"
                ? obs.output
                : JSON.stringify(obs.output),
            error: obs.error,
            tenantId: session.getTenantId(),
            namespace: session.getNamespace(),
          });
        }
      });
    }

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

        // Reconstruct messages prioritizing persisted metadata messages
        let messages: any[] = [];
        const rawMetadata = record.metadata as Record<string, unknown> | null;
        if (
          rawMetadata &&
          typeof rawMetadata === "object" &&
          Array.isArray(rawMetadata.messages) &&
          rawMetadata.messages.length > 0
        ) {
          messages = rawMetadata.messages;
        } else {
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

  list(filter?: { tenantId?: string; namespace?: string }): SessionSummary[] {
    let summaries = Array.from(this.sessions.values()).map((s) =>
      s.getSummary(),
    );
    if (filter?.tenantId && filter.tenantId !== "all") {
      summaries = summaries.filter((s) => s.tenantId === filter.tenantId);
    }
    if (filter?.namespace && filter.namespace !== "all") {
      summaries = summaries.filter((s) => s.namespace === filter.namespace);
    }
    const getTime = (val: Date | string | number | undefined): number => {
      if (!val) return 0;
      if (val instanceof Date) return val.getTime();
      return new Date(val).getTime() || 0;
    };
    return summaries.sort(
      (a, b) =>
        getTime(b.updatedAt || b.createdAt) -
        getTime(a.updatedAt || a.createdAt),
    );
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

      await this.sessionRepository.updateSession(session.id, {
        title: session.title,
        status: session.getStatus(),
        agentState: session.getState(),
        metadata: {
          ...session.metadata,
          messages: session.getMessages(),
        },
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
        metadata: {
          ...session.metadata,
          messages: session.getMessages(),
        },
      });
    }
  }

  async dispatch(
    id: SessionId,
    prompt: string,
    options: {
      priority?: number | JobPriority;
      maxRetries?: number;
      metadata?: Record<string, unknown>;
    } = {},
  ): Promise<AgentLoopResult> {
    const session = this.getOrThrow(id);
    session.queue();

    return new Promise<AgentLoopResult>((resolve, reject) => {
      this.jobScheduler
        .enqueue({
          sessionId: id,
          type: "session_run",
          tenantId: session.getTenantId(),
          namespace: session.getNamespace(),
          payload: { prompt, ...options.metadata },
          priority: options.priority ?? "normal",
          maxRetries: options.maxRetries,
        })
        .then((job) => {
          session.queue(job.id);
          this.emit("sessionQueued", {
            ...session.getSummary(),
            metadata: { ...session.metadata, jobId: job.id },
          });

          const onCompleted = (completedJob: Job) => {
            if (completedJob.id === job.id) {
              cleanup();
              resolve(completedJob.result as AgentLoopResult);
            }
          };

          const onDeadLetter = (dlqJob: Job, reason: string) => {
            if (dlqJob.id === job.id) {
              cleanup();
              reject(
                new Error(
                  `Job failed and entered dead letter queue: ${reason}`,
                ),
              );
            }
          };

          const cleanup = () => {
            this.jobScheduler.off("jobCompleted", onCompleted);
            this.jobScheduler.off("jobDeadLetter", onDeadLetter);
          };

          this.jobScheduler.on("jobCompleted", onCompleted);
          this.jobScheduler.on("jobDeadLetter", onDeadLetter);
        })
        .catch(reject);
    });
  }

  getJobScheduler(): JobScheduler {
    return this.jobScheduler;
  }

  getQueueMetrics(): QueueMetrics {
    return this.jobScheduler.getMetrics();
  }

  async enqueueJob<T = any, R = unknown>(
    options: EnqueueJobOptions<T>,
  ): Promise<Job<T, R>> {
    return this.jobScheduler.enqueue<T, R>(options);
  }
}
