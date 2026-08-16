import { z } from "zod";

export const InterSessionMessageTypeSchema = z.enum([
  "delegation",
  "result",
  "query",
  "event",
  "notification",
]);
export type InterSessionMessageType = z.infer<
  typeof InterSessionMessageTypeSchema
>;

export const InterSessionPayloadSchema = z
  .object({
    task: z.string().optional(),
    content: z.string().optional(),
    data: z.record(z.unknown()).optional(),
    correlationId: z.string().optional(),
  })
  .passthrough();
export type InterSessionPayload = z.infer<typeof InterSessionPayloadSchema>;

export const InterSessionMessageSchema = z.object({
  id: z.string().min(1),
  sourceSessionId: z.string().min(1),
  targetSessionId: z.string().min(1),
  type: InterSessionMessageTypeSchema.default("notification"),
  payload: InterSessionPayloadSchema,
  tenantId: z.string().optional(),
  namespace: z.string().optional(),
  timestamp: z.number().default(() => Date.now()),
  replyTo: z.string().optional(),
});
export type InterSessionMessage = z.infer<typeof InterSessionMessageSchema>;

export function createInterSessionMessage(params: {
  sourceSessionId: string;
  targetSessionId: string;
  type?: InterSessionMessageType;
  content?: string;
  task?: string;
  data?: Record<string, unknown>;
  correlationId?: string;
  tenantId?: string;
  namespace?: string;
  replyTo?: string;
}): InterSessionMessage {
  const id = `msg_inter_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  return InterSessionMessageSchema.parse({
    id,
    sourceSessionId: params.sourceSessionId,
    targetSessionId: params.targetSessionId,
    type: params.type || "notification",
    payload: {
      content: params.content,
      task: params.task,
      data: params.data,
      correlationId: params.correlationId,
    },
    tenantId: params.tenantId,
    namespace: params.namespace,
    timestamp: Date.now(),
    replyTo: params.replyTo || `sessions.${params.sourceSessionId}.inbox`,
  });
}
