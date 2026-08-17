import { z } from "zod";
import type { SessionConfig, SessionManagerConfig } from "./types";
import { getRoleRegistry } from "../roles/role-registry";

export const SessionConfigSchema = z.object({
  sessionId: z.string().optional(),
  title: z.string().optional(),
  role: z.string().optional(),
  tenantId: z.string().optional(),
  namespace: z.string().optional(),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxSteps: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type SessionConfiguration = z.infer<typeof SessionConfigSchema>;

export function resolveSessionConfig(
  input: Partial<SessionConfig> = {},
  defaults: Partial<SessionManagerConfig> = {},
): SessionConfig {
  const roleRegistry = getRoleRegistry();
  const hasExplicitRole = Boolean(input.role || input.metadata?.role);
  const roleId = input.role || (input.metadata?.role as string) || "general";
  const role = roleRegistry.getRole(roleId);

  const envModel = process.env.OPENROUTER_MODEL;
  const model =
    input.model ||
    defaults.defaultModel ||
    envModel ||
    (hasExplicitRole ? role.defaultModel : role.defaultModel) ||
    "openrouter/free";

  const systemPrompt =
    input.systemPrompt ||
    (hasExplicitRole
      ? role.systemPrompt
      : defaults.defaultSystemPrompt || role.systemPrompt);

  const temperature = input.temperature ?? 0.2;
  const maxSteps = input.maxSteps || defaults.defaultMaxSteps || 25;
  const tenantId =
    input.tenantId ||
    (input.metadata?.tenantId as string) ||
    process.env.CRUCIBLE_TENANT_ID ||
    "default";
  const namespace =
    input.namespace ||
    (input.metadata?.namespace as string) ||
    process.env.CRUCIBLE_NAMESPACE ||
    "crucible";

  const guardrails =
    input.guardrails ||
    (hasExplicitRole && role.id !== "general"
      ? roleRegistry.createRoleGuardrailChain(role, defaults.defaultGuardrails)
      : defaults.defaultGuardrails);

  return {
    ...input,
    role: role.id,
    model,
    systemPrompt,
    temperature,
    maxSteps,
    tenantId,
    namespace,
    guardrails,
    metadata: {
      ...input.metadata,
      role: role.id,
      roleName: role.name,
      readOnly: role.readOnly,
      model,
      tenantId,
      namespace,
    },
  };
}
