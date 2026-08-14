import { type PrismaClient } from "@prisma/client";
import { getPrismaClient } from "./client";
import { logger } from "../../observability/logger";
import { getErrorReporter } from "../../observability/error-reporter";

export type RunEventType =
  | "SESSION_CREATED"
  | "STEP_TRANSITION"
  | "MODEL_COMPLETION"
  | "TOOL_EXECUTION_START"
  | "TOOL_EXECUTION_FINISH"
  | "HUMAN_APPROVAL_REQUEST"
  | "HUMAN_APPROVAL_RESPONSE"
  | "SESSION_STATUS_CHANGED"
  | "ERROR_ENCOUNTERED"
  | "SESSION_COMPLETED";

export interface RunEventRecord {
  id: string;
  sessionId: string;
  sequenceNumber: number;
  eventType: RunEventType | string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface ReplayedSessionState {
  sessionId: string;
  status: string;
  agentState: string;
  title: string | null;
  modelSlug: string;
  systemPrompt: string | null;
  turnCount: number;
  toolCallCount: number;
  completedAt: Date | null;
  lastError: string | null;
  eventsCount: number;
}

/**
 * Event Sourcing Pattern: Durable Append-Only Event Store for Run History
 */
export class RunRepository {
  private prisma: PrismaClient;
  private sessionQueues = new Map<string, Promise<any>>();

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma || getPrismaClient();
  }

  async appendEvent(
    sessionId: string,
    eventType: RunEventType | string,
    payload: Record<string, unknown> = {},
  ): Promise<RunEventRecord> {
    const prev = this.sessionQueues.get(sessionId) || Promise.resolve();
    const task = prev
      .catch(() => {})
      .then(async () => {
        const lastEvent = await this.prisma.runEvent.findFirst({
          where: { sessionId },
          orderBy: { sequenceNumber: "desc" },
          select: { sequenceNumber: true },
        });

        const nextSequenceNumber = (lastEvent?.sequenceNumber ?? 0) + 1;

        const created = await this.prisma.runEvent.create({
          data: {
            sessionId,
            sequenceNumber: nextSequenceNumber,
            eventType,
            payload: payload as any,
          },
        });

        logger.debug(
          { sessionId, eventType, sequenceNumber: nextSequenceNumber },
          "[RunRepository] Appended run event (Event Sourcing)",
        );

        return created as unknown as RunEventRecord;
      });

    this.sessionQueues.set(sessionId, task);

    try {
      return await task;
    } catch (err: any) {
      logger.error(
        { err, sessionId, eventType },
        "[RunRepository] Failed to append event to Postgres event store",
      );
      getErrorReporter().captureAgentError(err, {
        sessionId,
        component: "RunRepository",
        alert: "CRUCIBLE_EVENT_SOURCING_PERSISTENCE_ALERT",
      });
      throw err;
    } finally {
      if (this.sessionQueues.get(sessionId) === task) {
        this.sessionQueues.delete(sessionId);
      }
    }
  }

  async getEvents(
    sessionId: string,
    options: {
      fromSequence?: number;
      limit?: number;
      eventTypes?: (RunEventType | string)[];
    } = {},
  ): Promise<RunEventRecord[]> {
    try {
      const events = await this.prisma.runEvent.findMany({
        where: {
          sessionId,
          ...(options.fromSequence !== undefined && {
            sequenceNumber: { gte: options.fromSequence },
          }),
          ...(options.eventTypes &&
            options.eventTypes.length > 0 && {
              eventType: { in: options.eventTypes },
            }),
        },
        orderBy: { sequenceNumber: "asc" },
        take: options.limit,
      });

      return events as unknown as RunEventRecord[];
    } catch (err: any) {
      logger.error(
        { err, sessionId },
        "[RunRepository] Failed to fetch events from event store",
      );
      getErrorReporter().captureAgentError(err, {
        sessionId,
        component: "RunRepository",
        alert: "CRUCIBLE_EVENT_SOURCING_PERSISTENCE_ALERT",
      });
      throw err;
    }
  }

  /**
   * Event Sourcing Replay: Reconstructs state from the immutable event stream
   */
  async replayEvents(sessionId: string): Promise<ReplayedSessionState> {
    const events = await this.getEvents(sessionId);

    const state: ReplayedSessionState = {
      sessionId,
      status: "idle",
      agentState: "awaiting_model",
      title: null,
      modelSlug: "nvidia/nemotron-3-nano-30b-a3b:free",
      systemPrompt: null,
      turnCount: 0,
      toolCallCount: 0,
      completedAt: null,
      lastError: null,
      eventsCount: events.length,
    };

    for (const event of events) {
      const p = event.payload || {};
      switch (event.eventType) {
        case "SESSION_CREATED":
          if (p.title) state.title = String(p.title);
          if (p.modelSlug) state.modelSlug = String(p.modelSlug);
          if (p.systemPrompt) state.systemPrompt = String(p.systemPrompt);
          state.status = "idle";
          state.agentState = "awaiting_model";
          break;

        case "STEP_TRANSITION":
          if (p.to) state.agentState = String(p.to);
          break;

        case "SESSION_STATUS_CHANGED":
          if (p.status) state.status = String(p.status);
          break;

        case "MODEL_COMPLETION":
          state.turnCount++;
          break;

        case "TOOL_EXECUTION_FINISH":
          state.toolCallCount++;
          break;

        case "ERROR_ENCOUNTERED":
          state.status = "error";
          state.lastError =
            (p.error as string) || (p.message as string) || "Unknown error";
          break;

        case "SESSION_COMPLETED":
          state.status = "done";
          state.completedAt = event.createdAt;
          break;
      }
    }

    return state;
  }
}
