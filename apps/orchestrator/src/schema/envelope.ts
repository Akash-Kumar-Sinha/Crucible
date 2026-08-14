import { z } from "zod";
export * from "@crucible/shared-schemas";

/**
 * Tool Call Envelope
 * Represents a tool execution request emitted by a model.
 */
export const ToolCallSchema = z.object({
  id: z.string().min(1, "Tool call ID is required"),
  name: z.string().min(1, "Tool name is required"),
  arguments: z.record(z.unknown()).default({}),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/**
 * Tool Execution Status
 */
export const ToolExecutionStatusSchema = z.enum([
  "success",
  "error",
  "rejected",
  "requires_approval",
]);
export type ToolExecutionStatus = z.infer<typeof ToolExecutionStatusSchema>;

/**
 * Tool Result Envelope
 * Represents an observation returned to the model after tool execution.
 */
export const ToolResultSchema = z.object({
  toolCallId: z.string().min(1, "Tool call ID is required"),
  name: z.string().min(1, "Tool name is required"),
  status: ToolExecutionStatusSchema,
  output: z.unknown(),
  error: z.string().optional(),
  metadata: z
    .object({
      durationMs: z.number().optional(),
      timestamp: z.number().default(() => Date.now()),
    })
    .default(() => ({ timestamp: Date.now() })),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

/**
 * Agent Roles
 */
export const AgentRoleSchema = z.enum(["system", "user", "assistant", "tool"]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

/**
 * Agent Message Schema
 */
export const AgentMessageSchema = z.object({
  role: AgentRoleSchema,
  content: z.string(),
  thought: z.string().optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolCallId: z.string().optional(),
  name: z.string().optional(),
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

/**
 * Thought-Action-Observation Record
 * Represents a single complete cycle in the agent loop.
 */
export const StepRecordSchema = z.object({
  step: z.number(),
  thought: z.string().optional(),
  actions: z.array(ToolCallSchema).default([]),
  observations: z.array(ToolResultSchema).default([]),
  timestamp: z.number().default(() => Date.now()),
});
export type StepRecord = z.infer<typeof StepRecordSchema>;
