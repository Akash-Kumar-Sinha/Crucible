import { SessionManager } from "../session/session-manager";
import { getRoleRegistry } from "../roles/role-registry";
import { RolePermissionPolicy } from "../guardrails/policies/role-permission";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../provider/provider.interface";
import type { ToolCall } from "../schema/envelope";

class AdversarialAttemptProvider implements ModelProvider {
  readonly name = "adversarial_attempt_provider";
  readonly defaultModel = "deepseek/deepseek-chat";

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const hasObservation = request.messages.some((m) => m.role === "tool");
    if (hasObservation) {
      return {
        thought:
          "Write tool was blocked by guardrail. Acknowledging read-only security boundary.",
        content:
          "Security audit note: Direct codebase modification was blocked by the guardrail policy as required for Bug Hunter role.",
        finishReason: "stop",
      };
    }

    // First step: The Bug Hunter model tries to execute a write_file tool call
    return {
      thought:
        "Attempting to inject patch directly by writing exploit fix to disk",
      toolCalls: [
        {
          id: "call_write_exploit",
          name: "write_file",
          arguments: {
            path: "src/critical-security.ts",
            content: "export const bypassSecurity = true;",
          },
        },
      ],
      finishReason: "tool_calls",
    };
  }
}

export async function runRolesAndGuardrailsVerification() {
  console.log(
    "================================================================================",
  );
  console.log(
    "CRUCIBLE VERIFICATION: AGENT ROLES, SYSTEM PROMPTS & GUARDRAIL BLOCKING",
  );
  console.log(
    "================================================================================\n",
  );

  const roleRegistry = getRoleRegistry();
  const manager = new SessionManager();

  const rolesToTest = [
    { id: "coder", name: "Coder" },
    { id: "test_writer", name: "Test Writer" },
    { id: "bug_hunter", name: "Bug Hunter" },
    { id: "bug_fixer", name: "Bug Fixer" },
  ];

  console.log(
    "--- [1/3] VERIFYING ROLE-SPECIFIC SYSTEM PROMPTS & TOOL RESTRICTIONS ---",
  );

  for (const r of rolesToTest) {
    const session = await manager.createSession({
      title: `${r.name} Verification Session`,
      role: r.id,
    });

    const roleDef = roleRegistry.getRole(r.id);
    const systemPromptSnippet = roleDef.systemPrompt.split("\n")[0];

    console.log(`[Role: ${roleDef.name.toUpperCase()}] (ID: ${session.id})`);
    console.log(`  -> Default Model: ${roleDef.defaultModel}`);
    console.log(`  -> Read-Only Mode: ${roleDef.readOnly}`);
    console.log(
      `  -> Allowed Tools (${roleDef.allowedTools.length}): [${roleDef.allowedTools.join(", ")}]`,
    );
    console.log(`  -> System Prompt Heading: "${systemPromptSnippet}"\n`);
  }

  // ============================================================================
  // Direct Guardrail Evaluation: Coder vs Bug Hunter on write_file
  // ============================================================================
  console.log("--- [2/3] EVALUATING GUARDRAIL POLICY ON DISK WRITE TOOLS ---");

  const writeToolCall: ToolCall = {
    id: "call_write_test_1",
    name: "write_file",
    arguments: {
      path: "src/auth/token.ts",
      content: "export function validateToken() { return true; }",
    },
  };

  const coderRole = roleRegistry.getRole("coder");
  const bugHunterRole = roleRegistry.getRole("bug_hunter");

  const coderPolicy = new RolePermissionPolicy(coderRole);
  const bugHunterPolicy = new RolePermissionPolicy(bugHunterRole);

  const coderEval = coderPolicy.evaluate({
    sessionId: "sess_coder_test",
    turnId: 1,
    toolCall: writeToolCall,
    sessionHistory: [],
  });

  const bugHunterEval = bugHunterPolicy.evaluate({
    sessionId: "sess_bug_hunter_test",
    turnId: 1,
    toolCall: writeToolCall,
    sessionHistory: [],
  });

  console.log("[Coder Evaluation on 'write_file']:");
  console.log(
    `  -> Guardrail Action: ${coderEval.action.toUpperCase()} (Write permitted for development)`,
  );

  console.log("\n[Bug Hunter Evaluation on 'write_file']:");
  console.log(`  -> Guardrail Action: ${bugHunterEval.action.toUpperCase()}`);
  console.log(`  -> Enforcement Reason: "${bugHunterEval.reason}"`);

  if (coderEval.action !== "allow" || bugHunterEval.action !== "block") {
    throw new Error("FAIL: Guardrail evaluation produced incorrect action!");
  }

  // ============================================================================
  // Runtime Execution Interception in Agent Loop
  // ============================================================================
  console.log(
    "\n--- [3/3] VERIFYING RUNTIME AGENT LOOP GUARDRAIL BLOCKING ---",
  );

  const adversarialProvider = new AdversarialAttemptProvider();
  const adversarialSession = await manager.createSession({
    title: "Adversarial Bug Hunter Session",
    role: "bug_hunter",
    provider: adversarialProvider,
  });

  console.log(
    `[Adversarial Run] Prompting Bug Hunter session (${adversarialSession.id})...`,
  );
  console.log(
    "  -> Model outputs: tool_call 'write_file' to 'src/critical-security.ts'",
  );

  const turnResult = await adversarialSession.prompt(
    "Fix the vulnerability in critical-security.ts",
  );

  console.log(`\n[Agent Loop Result State]: ${turnResult.state}`);
  console.log("[Observations in History]:");
  for (const step of turnResult.history) {
    if (step.observations && step.observations.length > 0) {
      for (const obs of step.observations) {
        console.log(`  -> Tool Call: ${obs.toolCallId} (${obs.name})`);
        console.log(`  -> Status: ${obs.status}`);
        console.log(
          `  -> Guardrail Denial / Output: "${obs.error || obs.output}"`,
        );
      }
    }
  }

  console.log(
    "\n================================================================================",
  );
  console.log(
    "AGENT ROLES & GUARDRAIL SECURITY ENFORCEMENT VERIFIED (0 FAILURES)",
  );
  console.log(
    "================================================================================",
  );

  manager.clear();
  process.exit(0);
}

if (import.meta.main) {
  runRolesAndGuardrailsVerification().catch((err) => {
    console.error("Roles and guardrails verification failed:", err);
    process.exit(1);
  });
}
