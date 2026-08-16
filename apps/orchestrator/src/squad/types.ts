import { z } from "zod";
import type { AgentRoleId } from "../roles/types";
import type { InterSessionMessageType } from "../session/inter-session-message";

export const SquadStageSchema = z.enum([
  "idle",
  "coding",
  "testing",
  "auditing",
  "fixing",
  "completed",
  "failed",
  "stalled",
]);
export type SquadStage = z.infer<typeof SquadStageSchema>;

export interface SquadMemberInfo {
  role: AgentRoleId;
  sessionId: string;
  model?: string;
  active: boolean;
}

export interface SquadStageTransition {
  fromStage: SquadStage;
  toStage: SquadStage;
  timestamp: number;
  triggerRole?: AgentRoleId;
  targetRole?: AgentRoleId;
  reason: string;
  payload?: Record<string, unknown>;
}

export interface SquadConfig {
  id?: string;
  name: string;
  tenantId?: string;
  namespace?: string;
  stageTimeoutMs?: number;
  maxFixIterations?: number;
  members?: Partial<Record<AgentRoleId, string>>;
  autoCreateSessions?: boolean;
}

export interface SquadSummary {
  id: string;
  name: string;
  stage: SquadStage;
  statusLine: string;
  activeRole?: AgentRoleId;
  activeSessionId?: string;
  members: Record<string, SquadMemberInfo>;
  activeGoal?: string;
  fixIterationCount: number;
  maxFixIterations: number;
  createdAt: number;
  updatedAt: number;
  stageStartedAt: number;
  stageTimeoutMs: number;
  history: SquadStageTransition[];
}

export interface HandoffDecision {
  nextStage: SquadStage;
  targetRole?: AgentRoleId;
  messageType: InterSessionMessageType;
  task: string;
  reason: string;
  findings?: string;
}
