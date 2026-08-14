import { z } from "zod";

/**
 * Envelope Schema Version Identifier
 */
export const ENVELOPE_VERSION_V1 = "v1" as const;
export type EnvelopeVersion = typeof ENVELOPE_VERSION_V1;

/**
 * Tool Execution Status
 */
export const ToolExecutionStatusSchema = z.enum([
  "success",
  "error",
  "requires_approval",
  "rejected",
]);
export type ToolExecutionStatus = z.infer<typeof ToolExecutionStatusSchema>;

/**
 * Tool Error Detail Specification
 */
export const ToolErrorDetailSchema = z.object({
  code: z.string().optional(),
  message: z.string().min(1, "Error message is required"),
  details: z.unknown().optional(),
});
export type ToolErrorDetail = z.infer<typeof ToolErrorDetailSchema>;

/**
 * Versioned Tool Call Request Envelope (v1)
 * Represents a normalized command to invoke a tool within the Crucible harness.
 */
export const ToolCallEnvelopeV1Schema = z.object({
  version: z.literal(ENVELOPE_VERSION_V1).default(ENVELOPE_VERSION_V1),
  callId: z.string().min(1, "callId is required"),
  toolName: z.string().min(1, "toolName is required"),
  input: z.record(z.unknown()).default({}),
  timestamp: z.number().default(() => Date.now()),
  metadata: z.record(z.unknown()).optional(),
});
export type ToolCallEnvelopeV1 = z.infer<typeof ToolCallEnvelopeV1Schema>;

/**
 * Versioned Tool Result Response Envelope (v1)
 * Represents a normalized observation emitted from tool execution back to the harness.
 */
export const ToolResultEnvelopeV1Schema = z.object({
  version: z.literal(ENVELOPE_VERSION_V1).default(ENVELOPE_VERSION_V1),
  callId: z.string().min(1, "callId is required"),
  toolName: z.string().min(1, "toolName is required"),
  status: ToolExecutionStatusSchema,
  output: z.unknown().optional(),
  error: ToolErrorDetailSchema.optional(),
  durationMs: z.number().optional(),
  timestamp: z.number().default(() => Date.now()),
  metadata: z.record(z.unknown()).optional(),
});
export type ToolResultEnvelopeV1 = z.infer<typeof ToolResultEnvelopeV1Schema>;

/**
 * Factory helper to construct a valid ToolCallEnvelopeV1
 */
export function createToolCallV1(params: {
  callId: string;
  toolName: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): ToolCallEnvelopeV1 {
  return ToolCallEnvelopeV1Schema.parse({
    version: ENVELOPE_VERSION_V1,
    callId: params.callId,
    toolName: params.toolName,
    input: params.input || {},
    timestamp: Date.now(),
    metadata: params.metadata,
  });
}

/**
 * Factory helper to construct a successful ToolResultEnvelopeV1
 */
export function createToolSuccessResultV1(params: {
  callId: string;
  toolName: string;
  output: unknown;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}): ToolResultEnvelopeV1 {
  return ToolResultEnvelopeV1Schema.parse({
    version: ENVELOPE_VERSION_V1,
    callId: params.callId,
    toolName: params.toolName,
    status: "success",
    output: params.output,
    durationMs: params.durationMs,
    timestamp: Date.now(),
    metadata: params.metadata,
  });
}

/**
 * Factory helper to construct an error ToolResultEnvelopeV1
 */
export function createToolErrorResultV1(params: {
  callId: string;
  toolName: string;
  message: string;
  code?: string;
  details?: unknown;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}): ToolResultEnvelopeV1 {
  return ToolResultEnvelopeV1Schema.parse({
    version: ENVELOPE_VERSION_V1,
    callId: params.callId,
    toolName: params.toolName,
    status: "error",
    error: {
      message: params.message,
      code: params.code,
      details: params.details,
    },
    durationMs: params.durationMs,
    timestamp: Date.now(),
    metadata: params.metadata,
  });
}

/**
 * Factory helper to construct an approval-required ToolResultEnvelopeV1
 */
export function createToolRequiresApprovalV1(params: {
  callId: string;
  toolName: string;
  metadata?: Record<string, unknown>;
}): ToolResultEnvelopeV1 {
  return ToolResultEnvelopeV1Schema.parse({
    version: ENVELOPE_VERSION_V1,
    callId: params.callId,
    toolName: params.toolName,
    status: "requires_approval",
    timestamp: Date.now(),
    metadata: params.metadata,
  });
}

/**
 * Factory helper to construct a rejected ToolResultEnvelopeV1
 */
export function createToolRejectedResultV1(params: {
  callId: string;
  toolName: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}): ToolResultEnvelopeV1 {
  return ToolResultEnvelopeV1Schema.parse({
    version: ENVELOPE_VERSION_V1,
    callId: params.callId,
    toolName: params.toolName,
    status: "rejected",
    error: {
      message: params.reason || "Action was rejected by user.",
      code: "USER_REJECTED",
    },
    timestamp: Date.now(),
    metadata: params.metadata,
  });
}
