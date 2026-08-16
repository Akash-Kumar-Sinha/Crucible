import { EventEmitter } from "node:events";
import type { AgentRoleId } from "../roles/types";
import { getSessionBus } from "../session/session-bus";
import { createInterSessionMessage } from "../session/inter-session-message";
import { getErrorReporter } from "../observability/error-reporter";
import { logger } from "../observability/logger";
import { evaluateHandoffRules } from "./handoff-rules";
import type {
  SquadConfig,
  SquadMemberInfo,
  SquadStage,
  SquadStageTransition,
  SquadSummary,
  HandoffDecision,
} from "./types";

/**
 * State Machine pattern: Squad lifecycle and explicit stage management
 */
export class Squad extends EventEmitter {
  readonly id: string;
  readonly name: string;
  readonly tenantId?: string;
  readonly namespace?: string;
  private currentStage: SquadStage = "idle";
  private members = new Map<AgentRoleId, SquadMemberInfo>();
  private activeGoal?: string;
  private fixIterationCount = 0;
  private readonly maxFixIterations: number;
  private readonly stageTimeoutMs: number;
  private stageStartedAt: number;
  private readonly createdAt: number;
  private updatedAt: number;
  private history: SquadStageTransition[] = [];
  private statusLine: string;

  constructor(config: SquadConfig) {
    super();
    this.id =
      config.id ||
      `squad_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.name = config.name;
    this.tenantId = config.tenantId;
    this.namespace = config.namespace;
    this.stageTimeoutMs = config.stageTimeoutMs ?? 60_000;
    this.maxFixIterations = config.maxFixIterations ?? 5;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    this.stageStartedAt = Date.now();
    this.statusLine = "Squad initialized. Awaiting task goal.";

    if (config.members) {
      for (const [roleStr, sessId] of Object.entries(config.members)) {
        if (sessId) {
          const role = roleStr as AgentRoleId;
          this.members.set(role, {
            role,
            sessionId: sessId,
            active: true,
          });
        }
      }
    }
  }

  getStage(): SquadStage {
    return this.currentStage;
  }

  getStatusLine(): string {
    return this.statusLine;
  }

  getMembers(): Map<AgentRoleId, SquadMemberInfo> {
    return new Map(this.members);
  }

  getMemberByRole(role: AgentRoleId): SquadMemberInfo | undefined {
    return this.members.get(role);
  }

  getMemberBySessionId(sessionId: string): SquadMemberInfo | undefined {
    for (const member of this.members.values()) {
      if (member.sessionId === sessionId) return member;
    }
    return undefined;
  }

  registerMember(role: AgentRoleId, sessionId: string, model?: string): void {
    this.members.set(role, {
      role,
      sessionId,
      model,
      active: true,
    });
    this.updatedAt = Date.now();
    this.emit("memberRegistered", { role, sessionId });
  }

  /**
   * Start the Squad pipeline with an initial goal
   */
  async start(goal: string): Promise<SquadSummary> {
    this.activeGoal = goal;
    this.fixIterationCount = 0;
    const coderMember = this.members.get("coder");

    const reason =
      "Starting squad workflow -> dispatching initial goal to Coder";
    this.statusLine = `Squad started: Goal dispatched to Coder`;

    await this.transition("coding", {
      targetRole: "coder",
      reason,
      payload: {
        task: goal,
        initialGoal: goal,
      },
    });

    if (coderMember) {
      const bus = getSessionBus();
      const msg = createInterSessionMessage({
        sourceSessionId: this.id,
        targetSessionId: coderMember.sessionId,
        type: "delegation",
        task: goal,
        content: `[Squad: ${this.name}] Initial Task Goal: ${goal}`,
        tenantId: this.tenantId,
        namespace: this.namespace,
      });
      bus.publish(msg);
    }

    return this.getSummary();
  }

  /**
   * Stage State Machine Transition
   */
  async transition(
    toStage: SquadStage,
    details: {
      triggerRole?: AgentRoleId;
      targetRole?: AgentRoleId;
      reason: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<void> {
    const fromStage = this.currentStage;
    this.currentStage = toStage;
    this.stageStartedAt = Date.now();
    this.updatedAt = Date.now();
    this.statusLine = details.reason;

    const transitionRecord: SquadStageTransition = {
      fromStage,
      toStage,
      timestamp: Date.now(),
      triggerRole: details.triggerRole,
      targetRole: details.targetRole,
      reason: details.reason,
      payload: details.payload,
    };

    this.history.push(transitionRecord);

    logger.info(
      {
        squadId: this.id,
        squadName: this.name,
        fromStage,
        toStage,
        triggerRole: details.triggerRole,
        targetRole: details.targetRole,
        reason: details.reason,
      },
      `[Squad State Machine] ${this.name}: ${fromStage} -> ${toStage} (${details.reason})`,
    );

    this.emit("stageChange", {
      squadId: this.id,
      fromStage,
      toStage,
      statusLine: this.statusLine,
      details,
    });

    this.emit("transition", transitionRecord);

    // If target role is defined, dispatch inter-session message via SessionBus
    if (details.targetRole) {
      const targetMember = this.members.get(details.targetRole);
      if (targetMember) {
        const bus = getSessionBus();
        const sourceSessionId = details.triggerRole
          ? this.members.get(details.triggerRole)?.sessionId || this.id
          : this.id;

        const msg = createInterSessionMessage({
          sourceSessionId,
          targetSessionId: targetMember.sessionId,
          type: "delegation",
          task: (details.payload?.task as string) || details.reason,
          content: `[Squad: ${this.name}] Hand-off from ${details.triggerRole || "Coordinator"}: ${details.reason}`,
          data: {
            squadId: this.id,
            squadName: this.name,
            fromStage,
            toStage,
            ...details.payload,
          },
          tenantId: this.tenantId,
          namespace: this.namespace,
        });

        bus.publish(msg);
      }
    }
  }

  /**
   * Handle session turn completion and evaluate automated hand-off rules
   */
  async handleTurnCompleted(
    role: AgentRoleId,
    _sessionId: string,
    output: string,
    error?: string,
  ): Promise<HandoffDecision> {
    const decision = evaluateHandoffRules({
      currentStage: this.currentStage,
      triggerRole: role,
      output,
      error,
      fixIterationCount: this.fixIterationCount,
      maxFixIterations: this.maxFixIterations,
    });

    if (decision.nextStage === "fixing") {
      this.fixIterationCount += 1;
    }

    await this.transition(decision.nextStage, {
      triggerRole: role,
      targetRole: decision.targetRole,
      reason: decision.reason,
      payload: {
        task: decision.task,
        output,
        findings: decision.findings,
        error,
        fixIterationCount: this.fixIterationCount,
      },
    });

    return decision;
  }

  /**
   * Health Check: Detect stalled stages past timeout limit
   */
  checkStall(): boolean {
    const activeStages: SquadStage[] = [
      "coding",
      "testing",
      "auditing",
      "fixing",
    ];
    if (!activeStages.includes(this.currentStage)) {
      return false;
    }

    const elapsedMs = Date.now() - this.stageStartedAt;
    if (elapsedMs > this.stageTimeoutMs) {
      const activeRole = this.getActiveRoleForStage(this.currentStage);
      const activeSession = activeRole
        ? this.members.get(activeRole)?.sessionId
        : undefined;

      getErrorReporter().recordSquadStalledAlert({
        squadId: this.id,
        squadName: this.name,
        stage: this.currentStage,
        elapsedMs,
        timeoutMs: this.stageTimeoutMs,
        activeRole,
        activeSessionId: activeSession,
        tenantId: this.tenantId,
        namespace: this.namespace,
        reason: `Squad stage ${this.currentStage} stalled after ${Math.round(elapsedMs / 1000)}s without completing hand-off.`,
      });

      const fromStage = this.currentStage;
      this.currentStage = "stalled";
      this.statusLine = `[STALLED] Squad stalled in stage '${fromStage}' past ${Math.round(this.stageTimeoutMs / 1000)}s timeout.`;
      this.emit("stalled", {
        squadId: this.id,
        elapsedMs,
        timeoutMs: this.stageTimeoutMs,
      });
      this.emit("stageChange", {
        squadId: this.id,
        fromStage,
        toStage: "stalled",
        statusLine: this.statusLine,
      });

      return true;
    }

    return false;
  }

  private getActiveRoleForStage(stage: SquadStage): AgentRoleId | undefined {
    switch (stage) {
      case "coding":
        return "coder";
      case "testing":
        return "test_writer";
      case "auditing":
        return "bug_hunter";
      case "fixing":
        return "bug_fixer";
      default:
        return undefined;
    }
  }

  getSummary(): SquadSummary {
    const membersMap: Record<string, SquadMemberInfo> = {};
    for (const [r, m] of this.members.entries()) {
      membersMap[r] = m;
    }

    const activeRole = this.getActiveRoleForStage(this.currentStage);
    const activeSessionId = activeRole
      ? this.members.get(activeRole)?.sessionId
      : undefined;

    return {
      id: this.id,
      name: this.name,
      stage: this.currentStage,
      statusLine: this.statusLine,
      activeRole,
      activeSessionId,
      members: membersMap,
      activeGoal: this.activeGoal,
      fixIterationCount: this.fixIterationCount,
      maxFixIterations: this.maxFixIterations,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      stageStartedAt: this.stageStartedAt,
      stageTimeoutMs: this.stageTimeoutMs,
      history: [...this.history],
    };
  }
}
