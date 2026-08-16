import { SessionManager } from "../session/session-manager";
import { ToolRegistry } from "../tools/registry";
import { createBashTool } from "../tools/builtin/bash";
import { KubernetesJobExecutor } from "../execution/k8s-job-executor";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../provider/provider.interface";

class K8sTestMockProvider implements ModelProvider {
  readonly name = "k8s-test-mock";
  readonly defaultModel = "mock-model";
  private turn = 0;

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.turn++;
    if (this.turn === 1) {
      // Step 1: Agent decides to call bash_exec tool on Kubernetes
      return {
        content:
          "<thought>I need to compute 15 * 15 inside the Kubernetes sandbox</thought>",
        toolCalls: [
          {
            id: "call_k8s_bash_1",
            name: "bash_exec",
            arguments: {
              command:
                "node -e 'console.log(\"K8S_POD_COMPUTE_RESULT:\", 15 * 15)'",
            },
          },
        ],
        finishReason: "tool_calls",
      };
    }

    // Step 2: Agent observes tool result from Kubernetes Job and concludes
    const lastMsg = request.messages[request.messages.length - 1];
    return {
      content: `The computed result inside the Kubernetes sandbox Job is: ${lastMsg.content.trim()}`,
      finishReason: "stop",
    };
  }
}

async function main() {
  console.log("=================================================");
  console.log("  Crucible Agent Loop with Kubernetes Job Runner ");
  console.log("=================================================");

  const k8sExecutor = new KubernetesJobExecutor({
    apiUrl: "http://127.0.0.1:8001",
    namespace: "crucible",
  });

  const tools = new ToolRegistry().register(
    createBashTool({ executor: k8sExecutor }),
  );
  const sessionManager = new SessionManager({
    defaultProvider: new K8sTestMockProvider(),
    defaultTools: tools,
  });

  const session = sessionManager.createSession();
  console.log(`\nCreated Session: ${session.id}`);

  // Listen to session events
  session.on("stateChange", (event: any) => {
    console.log(
      `[State Transition] ${event.from || "active"} -> ${event.to || event.state}`,
    );
  });

  session.on("toolStart", (_toolCalls: any) => {
    console.log(`[Tool Start] Executing tool on Kubernetes cluster...`);
  });

  session.on("toolResult", (results: any[]) => {
    console.log(
      `[Tool Result from K8s Job] Output: ${results.map((r) => r.output).join(" | ")}`,
    );
  });

  console.log("\nSending prompt to Agent Loop...");
  const result = await session.prompt(
    "Run bash command to calculate 15 * 15 inside the sandbox",
  );

  console.log("\nAgent Final Response:");
  console.log("-------------------------------------------------");
  console.log(result.finalResponse);
  console.log("-------------------------------------------------");

  if (result.finalResponse?.includes("225")) {
    console.log(
      "\n[SUCCESS] End-to-End Agent Loop executed tool inside dynamic Kubernetes Job and verified output!",
    );
  } else {
    console.error(
      "\n[FAILURE] Final response did not contain expected computation result.",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
