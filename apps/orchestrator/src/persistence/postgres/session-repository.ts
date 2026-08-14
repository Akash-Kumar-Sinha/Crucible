import { type PrismaClient } from "../../generated/prisma";
import { getPrismaClient } from "./client";
import { logger } from "../../observability/logger";
import { getErrorReporter } from "../../observability/error-reporter";

export interface SessionRecord {
  id: string;
  title: string | null;
  status: string;
  agentState: string;
  modelSlug: string;
  systemPrompt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TurnRecord {
  id: string;
  turnNumber: number;
  sessionId: string;
  thought: string | null;
  modelOutput: string | null;
  durationMs: number | null;
  createdAt: Date;
  toolCalls: ToolCallRecord[];
}

export interface ToolCallRecord {
  id: string;
  turnId: string;
  name: string;
  arguments: Record<string, unknown>;
  status: string;
  stdout: string | null;
  stderr: string | null;
  output: unknown | null;
  error: unknown | null;
  durationMs: number | null;
  createdAt: Date;
}

export interface SessionDetailRecord extends SessionRecord {
  turns: TurnRecord[];
}

export interface CreateSessionData {
  id: string;
  title?: string;
  systemPrompt?: string;
  modelSlug?: string;
  metadata?: Record<string, unknown>;
  status?: string;
  agentState?: string;
}

export interface UpdateSessionData {
  title?: string;
  status?: string;
  agentState?: string;
  metadata?: Record<string, unknown>;
}

export interface RecordTurnData {
  thought?: string;
  modelOutput?: string;
  durationMs?: number;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    status?: string;
    stdout?: string;
    stderr?: string;
    output?: unknown;
    error?: unknown;
    durationMs?: number;
  }>;
}

/**
 * Repository Pattern: PostgreSQL Session Persistence via Prisma
 */
export class SessionRepository {
  private prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma || getPrismaClient();
  }

  async createSession(data: CreateSessionData): Promise<SessionRecord> {
    try {
      const created = await this.prisma.session.upsert({
        where: { id: data.id },
        update: {
          ...(data.title !== undefined && { title: data.title }),
          ...(data.systemPrompt !== undefined && {
            systemPrompt: data.systemPrompt,
          }),
          ...(data.modelSlug !== undefined && { modelSlug: data.modelSlug }),
          ...(data.status !== undefined && { status: data.status }),
          ...(data.agentState !== undefined && { agentState: data.agentState }),
          ...(data.metadata !== undefined && {
            metadata: data.metadata as any,
          }),
          updatedAt: new Date(),
        },
        create: {
          id: data.id,
          title: data.title ?? null,
          systemPrompt: data.systemPrompt ?? null,
          modelSlug: data.modelSlug ?? "nvidia/nemotron-3-nano-30b-a3b:free",
          status: data.status ?? "idle",
          agentState: data.agentState ?? "awaiting_model",
          metadata: (data.metadata as any) ?? null,
        },
      });

      logger.debug(
        { sessionId: created.id },
        "[SessionRepository] Created persistent session",
      );
      return created as unknown as SessionRecord;
    } catch (err: any) {
      logger.error(
        { err, sessionId: data.id },
        "[SessionRepository] Failed to create session in Postgres",
      );
      getErrorReporter().captureAgentError(err, {
        sessionId: data.id,
        component: "SessionRepository",
        alert: "CRUCIBLE_DATABASE_PERSISTENCE_FAILURE_ALERT",
      });
      throw err;
    }
  }

  async updateSession(
    id: string,
    data: UpdateSessionData,
  ): Promise<SessionRecord | null> {
    try {
      const updated = await this.prisma.session.update({
        where: { id },
        data: {
          ...(data.title !== undefined && { title: data.title }),
          ...(data.status !== undefined && { status: data.status }),
          ...(data.agentState !== undefined && { agentState: data.agentState }),
          ...(data.metadata !== undefined && {
            metadata: data.metadata as any,
          }),
          updatedAt: new Date(),
        },
      });

      return updated as unknown as SessionRecord;
    } catch (err: any) {
      logger.error(
        { err, sessionId: id },
        "[SessionRepository] Failed to update session in Postgres",
      );
      getErrorReporter().captureAgentError(err, {
        sessionId: id,
        component: "SessionRepository",
        alert: "CRUCIBLE_DATABASE_PERSISTENCE_FAILURE_ALERT",
      });
      throw err;
    }
  }

  async getSession(id: string): Promise<SessionDetailRecord | null> {
    try {
      const session = await this.prisma.session.findUnique({
        where: { id },
        include: {
          turns: {
            orderBy: { turnNumber: "asc" },
            include: {
              toolCalls: {
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      });

      return (session as unknown as SessionDetailRecord) || null;
    } catch (err: any) {
      logger.error(
        { err, sessionId: id },
        "[SessionRepository] Failed to get session from Postgres",
      );
      getErrorReporter().captureAgentError(err, {
        sessionId: id,
        component: "SessionRepository",
        alert: "CRUCIBLE_DATABASE_PERSISTENCE_FAILURE_ALERT",
      });
      throw err;
    }
  }

  async listSessions(): Promise<SessionRecord[]> {
    try {
      const sessions = await this.prisma.session.findMany({
        orderBy: { updatedAt: "desc" },
      });

      return sessions as unknown as SessionRecord[];
    } catch (err: any) {
      logger.error(
        { err },
        "[SessionRepository] Failed to list sessions from Postgres",
      );
      getErrorReporter().captureAgentError(err, {
        component: "SessionRepository",
        alert: "CRUCIBLE_DATABASE_PERSISTENCE_FAILURE_ALERT",
      });
      throw err;
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    try {
      await this.prisma.session.delete({
        where: { id },
      });
      return true;
    } catch (err: any) {
      logger.warn(
        { err, sessionId: id },
        "[SessionRepository] Failed to delete session from Postgres",
      );
      return false;
    }
  }

  async recordTurn(
    sessionId: string,
    turnNumber: number,
    data: RecordTurnData,
  ): Promise<TurnRecord> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const turn = await tx.turn.upsert({
          where: {
            sessionId_turnNumber: {
              sessionId,
              turnNumber,
            },
          },
          update: {
            thought: data.thought ?? null,
            modelOutput: data.modelOutput ?? null,
            durationMs: data.durationMs ?? null,
          },
          create: {
            sessionId,
            turnNumber,
            thought: data.thought ?? null,
            modelOutput: data.modelOutput ?? null,
            durationMs: data.durationMs ?? null,
          },
        });

        if (data.toolCalls && data.toolCalls.length > 0) {
          for (const tc of data.toolCalls) {
            await tx.toolCall.upsert({
              where: { id: tc.id },
              update: {
                name: tc.name,
                arguments: tc.arguments as any,
                status: tc.status ?? "SUCCESS",
                stdout: tc.stdout ?? null,
                stderr: tc.stderr ?? null,
                output: (tc.output as any) ?? null,
                error: (tc.error as any) ?? null,
                durationMs: tc.durationMs ?? null,
              },
              create: {
                id: tc.id,
                turnId: turn.id,
                name: tc.name,
                arguments: tc.arguments as any,
                status: tc.status ?? "SUCCESS",
                stdout: tc.stdout ?? null,
                stderr: tc.stderr ?? null,
                output: (tc.output as any) ?? null,
                error: (tc.error as any) ?? null,
                durationMs: tc.durationMs ?? null,
              },
            });
          }
        }

        await tx.session.update({
          where: { id: sessionId },
          data: { updatedAt: new Date() },
        });

        const turnWithTools = await tx.turn.findUnique({
          where: { id: turn.id },
          include: { toolCalls: true },
        });

        return turnWithTools as unknown as TurnRecord;
      });
    } catch (err: any) {
      logger.error(
        { err, sessionId, turnNumber },
        "[SessionRepository] Failed to record turn in Postgres",
      );
      getErrorReporter().captureAgentError(err, {
        sessionId,
        turnId: turnNumber,
        component: "SessionRepository",
        alert: "CRUCIBLE_DATABASE_PERSISTENCE_FAILURE_ALERT",
      });
      throw err;
    }
  }

  async loadAllSessions(): Promise<SessionDetailRecord[]> {
    try {
      const sessions = await this.prisma.session.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          turns: {
            orderBy: { turnNumber: "asc" },
            include: {
              toolCalls: {
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      });

      return sessions as unknown as SessionDetailRecord[];
    } catch (err: any) {
      logger.error(
        { err },
        "[SessionRepository] Failed to load all sessions across restart",
      );
      getErrorReporter().captureAgentError(err, {
        component: "SessionRepository",
        alert: "CRUCIBLE_DATABASE_PERSISTENCE_FAILURE_ALERT",
      });
      throw err;
    }
  }
}
