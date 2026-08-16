import { EventEmitter } from "node:events";
import type { SessionManager } from "../session/session-manager";
import type { AgentRoleId } from "../roles/types";
import { Squad } from "./squad";
import type { SquadConfig, SquadStage, SquadSummary } from "./types";
import { logger } from "../observability/logger";

/**
 * Mediator pattern: SquadManager coordinates multi-agent squads,
 * automatic session creation per role, and stage stall health checks.
 */
export class SquadManager extends EventEmitter {
  private squads = new Map<string, Squad>();
  private sessionToSquad = new Map<string, string>();
  private sessionManager?: SessionManager;
  private stallCheckTimer?: NodeJS.Timeout;

  constructor(sessionManager?: SessionManager) {
    super();
    this.sessionManager = sessionManager;
  }

  setSessionManager(sessionManager: SessionManager): void {
    this.sessionManager = sessionManager;
  }

  /**
   * Create a new Squad, optionally auto-provisioning role sessions
   */
  async createSquad(config: SquadConfig): Promise<Squad> {
    const squadId =
      config.id ||
      `squad_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const squad = new Squad({
      ...config,
      id: squadId,
    });

    const rolesToProvision: AgentRoleId[] = [
      "coder",
      "test_writer",
      "bug_hunter",
      "bug_fixer",
    ];

    // If sessionManager is provided and autoCreateSessions is true, create missing role sessions
    if (this.sessionManager && config.autoCreateSessions !== false) {
      for (const role of rolesToProvision) {
        if (!config.members?.[role]) {
          try {
            const sess = this.sessionManager.createSession({
              role,
              tenantId: config.tenantId,
              namespace: config.namespace,
              metadata: {
                squadId,
                squadName: config.name,
                role,
              },
            });
            squad.registerMember(role, sess.id, sess.getModel());
            this.sessionToSquad.set(sess.id, squadId);
          } catch (err: unknown) {
            logger.warn(
              { squadId, role, err },
              `Failed to auto-provision session for role ${role}`,
            );
          }
        }
      }
    }

    // Map existing member sessions
    for (const [role, member] of squad.getMembers().entries()) {
      this.sessionToSquad.set(member.sessionId, squadId);
      this.bindSessionEvents(squad, role, member.sessionId);
    }

    // Forward squad events
    squad.on("stageChange", (event) => {
      this.emit("stageChange", event);
    });
    squad.on("stalled", (event) => {
      this.emit("squadStalled", event);
    });

    this.squads.set(squadId, squad);
    this.emit("squadCreated", squad.getSummary());

    logger.info(
      { squadId, name: config.name, membersCount: squad.getMembers().size },
      `[SquadManager] Created squad '${config.name}' (${squadId})`,
    );

    return squad;
  }

  private bindSessionEvents(
    squad: Squad,
    role: AgentRoleId,
    sessionId: string,
  ): void {
    if (!this.sessionManager) return;
    const session = this.sessionManager.get(sessionId);
    if (!session) return;

    // Listen to session completion events
    session.on(
      "turnCompleted",
      async (event: { output?: string; error?: string }) => {
        // Only trigger handoff if this role is the active role of the current stage
        const currentStage = squad.getStage();
        const isRoleActiveForStage =
          (currentStage === "coding" && role === "coder") ||
          (currentStage === "testing" && role === "test_writer") ||
          (currentStage === "auditing" && role === "bug_hunter") ||
          (currentStage === "fixing" && role === "bug_fixer");

        if (isRoleActiveForStage) {
          await squad.handleTurnCompleted(
            role,
            sessionId,
            event.output || "",
            event.error,
          );
        }
      },
    );
  }

  getSquad(id: string): Squad | undefined {
    return this.squads.get(id);
  }

  getOrThrow(id: string): Squad {
    const squad = this.squads.get(id);
    if (!squad) {
      throw new Error(`Squad with ID '${id}' not found`);
    }
    return squad;
  }

  getSquadForSession(sessionId: string): Squad | undefined {
    const squadId = this.sessionToSquad.get(sessionId);
    if (!squadId) return undefined;
    return this.squads.get(squadId);
  }

  listSquads(): SquadSummary[] {
    return Array.from(this.squads.values()).map((s) => s.getSummary());
  }

  async startSquad(id: string, goal: string): Promise<SquadSummary> {
    const squad = this.getOrThrow(id);
    return squad.start(goal);
  }

  async transitionSquad(
    id: string,
    toStage: SquadStage,
    details: {
      triggerRole?: AgentRoleId;
      targetRole?: AgentRoleId;
      reason: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<SquadSummary> {
    const squad = this.getOrThrow(id);
    await squad.transition(toStage, details);
    return squad.getSummary();
  }

  /**
   * Health Check: Sweep all squads for stalled stages
   */
  checkStalls(): number {
    let stalledCount = 0;
    for (const squad of this.squads.values()) {
      const isStalled = squad.checkStall();
      if (isStalled) stalledCount++;
    }
    return stalledCount;
  }

  startPeriodicStallCheck(intervalMs = 10_000): void {
    this.stopPeriodicStallCheck();
    this.stallCheckTimer = setInterval(() => {
      this.checkStalls();
    }, intervalMs);
    if (this.stallCheckTimer.unref) {
      this.stallCheckTimer.unref();
    }
  }

  stopPeriodicStallCheck(): void {
    if (this.stallCheckTimer) {
      clearInterval(this.stallCheckTimer);
      this.stallCheckTimer = undefined;
    }
  }

  clear(): void {
    this.stopPeriodicStallCheck();
    this.squads.clear();
    this.sessionToSquad.clear();
  }
}

let defaultSquadManager: SquadManager | null = null;

export function getSquadManager(sessionManager?: SessionManager): SquadManager {
  if (!defaultSquadManager) {
    defaultSquadManager = new SquadManager(sessionManager);
    defaultSquadManager.startPeriodicStallCheck(10_000);
  } else if (sessionManager) {
    defaultSquadManager.setSessionManager(sessionManager);
  }
  return defaultSquadManager;
}

export function resetSquadManager(): void {
  if (defaultSquadManager) {
    defaultSquadManager.clear();
    defaultSquadManager = null;
  }
}
