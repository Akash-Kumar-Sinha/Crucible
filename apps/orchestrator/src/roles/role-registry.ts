import type { AgentRole, AgentRoleId } from "./types";
import { coderRole } from "./roles/coder";
import { testWriterRole } from "./roles/test-writer";
import { bugHunterRole } from "./roles/bug-hunter";
import { bugFixerRole } from "./roles/bug-fixer";
import { ToolRegistry } from "../tools/registry";
import { GuardrailChain } from "../guardrails/chain";
import { IrreversibleActionPolicy } from "../guardrails/policies/irreversible-action";
import { ResourceBudgetPolicy } from "../guardrails/policies/resource-budget";
import { RolePermissionPolicy } from "../guardrails/policies/role-permission";
import type { SessionConfig } from "../session/types";

export const generalRole: AgentRole = {
  id: "general",
  name: "General Assistant",
  description:
    "Standard autonomous software development and task reasoning agent.",
  defaultModel: process.env.OPENROUTER_MODEL || "openrouter/free",
  allowedTools: [
    "bash_exec",
    "read_file",
    "write_file",
    "calculator",
    "get_current_time",
  ],
  readOnly: false,
  tagColor: "zinc",
  capabilities: ["General problem solving", "Code exploration", "Analysis"],
  systemPrompt: `You are Crucible Agent, an autonomous reasoning and coding assistant capable of using tools to accomplish complex programming and analysis tasks.`,
};

export class RoleRegistry {
  private roles = new Map<string, AgentRole>();

  constructor() {
    this.registerRole(coderRole);
    this.registerRole(testWriterRole);
    this.registerRole(bugHunterRole);
    this.registerRole(bugFixerRole);
    this.registerRole(generalRole);
  }

  registerRole(role: AgentRole): this {
    this.roles.set(role.id, role);
    return this;
  }

  getRole(id?: string): AgentRole {
    if (!id) return this.roles.get("general") || generalRole;
    const normalized = id.toLowerCase().replace(/[- ]/g, "_");
    return (
      this.roles.get(normalized) || this.roles.get("general") || generalRole
    );
  }

  hasRole(id: string): boolean {
    const normalized = id.toLowerCase().replace(/[- ]/g, "_");
    return this.roles.has(normalized);
  }

  listRoles(): AgentRole[] {
    return Array.from(this.roles.values());
  }

  createRoleFilteredToolRegistry(
    role: AgentRole,
    baseRegistry?: ToolRegistry,
  ): ToolRegistry {
    const source = baseRegistry || new ToolRegistry();
    const filtered = new ToolRegistry();

    for (const def of source.getDefinitions()) {
      if (role.allowedTools.includes(def.name)) {
        const fullTool = source.get(def.name);
        if (fullTool) {
          filtered.registerRecord(fullTool);
        }
      }
    }

    return filtered;
  }

  createRoleGuardrailChain(
    role: AgentRole,
    baseGuardrails?: GuardrailChain,
  ): GuardrailChain {
    if (baseGuardrails) {
      baseGuardrails.addPolicy(new RolePermissionPolicy(role));
      return baseGuardrails;
    }

    return new GuardrailChain({
      policies: [
        new IrreversibleActionPolicy(),
        new ResourceBudgetPolicy(),
        new RolePermissionPolicy(role),
      ],
    });
  }

  /**
   * Template Method Pattern: Bootstrap complete session configuration from role
   */
  bootstrapSessionConfig(
    input: Partial<SessionConfig> & { role?: string | AgentRoleId } = {},
    _baseRegistry?: ToolRegistry,
    baseGuardrails?: GuardrailChain,
  ): SessionConfig {
    const roleId = input.role || (input.metadata?.role as string) || "general";
    const role = this.getRole(roleId);

    const model = input.model || role.defaultModel;
    const systemPrompt = input.systemPrompt || role.systemPrompt;
    const guardrails = this.createRoleGuardrailChain(role, baseGuardrails);

    return {
      ...input,
      model,
      systemPrompt,
      guardrails,
      metadata: {
        ...input.metadata,
        role: role.id,
        roleName: role.name,
        readOnly: role.readOnly,
        model,
      },
    };
  }
}

let globalRoleRegistry: RoleRegistry | null = null;

export function getRoleRegistry(): RoleRegistry {
  if (!globalRoleRegistry) {
    globalRoleRegistry = new RoleRegistry();
  }
  return globalRoleRegistry;
}
