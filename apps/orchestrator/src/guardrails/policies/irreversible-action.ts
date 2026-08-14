import type {
  GuardrailEvaluationContext,
  GuardrailEvaluationResult,
  GuardrailPolicy,
} from "../types";

export interface IrreversibleActionOptions {
  mode?: "require_approval" | "block";
  customBlockedPatterns?: RegExp[];
  customApprovalPatterns?: RegExp[];
}

const DEFAULT_DESTRUCTIVE_COMMAND_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+|\s+-[a-zA-Z]*[rf][a-zA-Z]*\s+)/i,
  /\b(mkfs|fdisk|parted|gdisk)\b/i,
  /\bdd\s+if=/i,
  /\b(shutdown|reboot|poweroff|halt|init\s+[06])\b/i,
  /\b(DROP\s+DATABASE|DROP\s+TABLE|TRUNCATE\s+TABLE)\b/i,
  /\bchmod\s+(-R\s+)?(777|000)\s+(\/|\/etc|\/usr|\/root|\/var)\b/i,
  /\b(userdel|groupdel)\b/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  /\bkill\s+-9\s+1\b/i,
];

const DESTRUCTIVE_TOOL_NAMES: RegExp[] = [
  /^(delete_|destroy_|purge_|drop_|wipe_)/i,
];

export class IrreversibleActionPolicy implements GuardrailPolicy {
  readonly name = "irreversible_action";
  readonly description =
    "Detects destructive, irreversible operations and triggers a human approval checkpoint or block.";

  private mode: "require_approval" | "block";
  private destructivePatterns: RegExp[];

  constructor(options: IrreversibleActionOptions = {}) {
    this.mode = options.mode || "require_approval";
    this.destructivePatterns = [
      ...DEFAULT_DESTRUCTIVE_COMMAND_PATTERNS,
      ...(options.customApprovalPatterns || []),
      ...(options.customBlockedPatterns || []),
    ];
  }

  evaluate(context: GuardrailEvaluationContext): GuardrailEvaluationResult {
    const { toolCall, toolDefinition } = context;

    if (toolDefinition?.requiresApproval) {
      return {
        action: "require_approval",
        policyName: this.name,
        reason: `Tool '${toolCall.name}' is explicitly configured to require human approval.`,
      };
    }

    if (DESTRUCTIVE_TOOL_NAMES.some((rx) => rx.test(toolCall.name))) {
      return {
        action: this.mode,
        policyName: this.name,
        reason: `Tool '${toolCall.name}' is classified as a destructive action.`,
      };
    }

    const commandStr = this.extractCommandString(toolCall.arguments);
    if (commandStr) {
      for (const pattern of this.destructivePatterns) {
        if (pattern.test(commandStr)) {
          return {
            action: this.mode,
            policyName: this.name,
            reason: `Command matches dangerous/irreversible pattern: ${pattern.source}`,
            metadata: { command: commandStr, pattern: pattern.source },
          };
        }
      }
    }

    return {
      action: "allow",
      policyName: this.name,
    };
  }

  private extractCommandString(args: unknown): string | null {
    if (!args || typeof args !== "object") return null;
    const obj = args as Record<string, unknown>;
    if (typeof obj.command === "string") return obj.command;
    if (typeof obj.cmd === "string") return obj.cmd;
    if (typeof obj.script === "string") return obj.script;
    if (typeof obj.query === "string") return obj.query;
    return null;
  }
}
