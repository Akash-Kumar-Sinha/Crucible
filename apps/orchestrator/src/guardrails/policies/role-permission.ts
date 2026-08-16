import type {
  GuardrailPolicy,
  GuardrailEvaluationContext,
  GuardrailEvaluationResult,
} from "../types";
import type { AgentRole } from "../../roles/types";

export class RolePermissionPolicy implements GuardrailPolicy {
  readonly name = "role_permission_policy";
  readonly description =
    "Enforces role-based tool restrictions and read-only boundaries";

  constructor(private role: AgentRole) {}

  evaluate(context: GuardrailEvaluationContext): GuardrailEvaluationResult {
    const toolName = context.toolCall.name;

    // Read-only role restriction check
    if (
      this.role.readOnly &&
      (toolName === "write_file" ||
        toolName.startsWith("write_") ||
        toolName.includes("write"))
    ) {
      return {
        action: "block",
        policyName: this.name,
        reason: `Role '${this.role.name}' operates in read-only mode and cannot write or modify files on disk.`,
      };
    }

    // General role or wildcard allows all registered tools
    if (this.role.id === "general" || this.role.allowedTools.includes("*")) {
      return {
        action: "allow",
        policyName: this.name,
      };
    }

    if (!this.role.allowedTools.includes(toolName)) {
      return {
        action: "block",
        policyName: this.name,
        reason: `Role '${this.role.name}' is restricted from executing tool '${toolName}'. Allowed tools: ${this.role.allowedTools.join(", ")}`,
      };
    }

    return {
      action: "allow",
      policyName: this.name,
    };
  }
}
