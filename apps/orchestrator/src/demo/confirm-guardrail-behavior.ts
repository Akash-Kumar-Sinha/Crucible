import { startHttpServer } from "../http/server";
import { MockModelProvider } from "../provider/mock";
import { ToolRegistry } from "../tools/registry";
import { createBashTool, calculatorTool } from "../tools/builtin";
import { LocalExecutor } from "../execution/local-executor";
import { SessionManager } from "../session/session-manager";
import { GuardrailChain } from "../guardrails/chain";
import { IrreversibleActionPolicy } from "../guardrails/policies/irreversible-action";
import { ResourceBudgetPolicy } from "../guardrails/policies/resource-budget";

async function confirmGuardrailBehavior() {
  console.log(
    "================================================================================",
  );
  console.log(
    "🔍 LIVE GUARDRAIL BEHAVIOR CONFIRMATION: SAFE VS DESTRUCTIVE TOOL CALLS",
  );
  console.log(
    "================================================================================\n",
  );

  let actualCommandExecuted = false;
  const recordedCommands: string[] = [];

  class MonitoredLocalExecutor extends LocalExecutor {
    override async execute(req: any) {
      recordedCommands.push(req.command);
      if (req.command.includes("rm -rf")) {
        actualCommandExecuted = true;
      }
      return super.execute(req);
    }
  }

  const executor = new MonitoredLocalExecutor();
  const tools = new ToolRegistry()
    .register(calculatorTool)
    .register(createBashTool({ executor }));

  const guardrails = new GuardrailChain({
    policies: [
      new IrreversibleActionPolicy({ mode: "require_approval" }),
      new ResourceBudgetPolicy({
        maxCallsPerTurn: 5,
        maxConsecutiveIdenticalCalls: 2,
      }),
    ],
  });

  const provider = new MockModelProvider();
  const sessionManager = new SessionManager({
    defaultProvider: provider,
    defaultTools: tools,
    defaultGuardrails: guardrails,
  });

  const server = startHttpServer({
    port: 4005,
    hostname: "127.0.0.1",
    sessionManager,
  });

  const baseUrl = `http://127.0.0.1:${server.port}`;

  try {
    // -------------------------------------------------------------
    // Test 1: Legitimate Safe Tool Call Passes Unaffected
    // -------------------------------------------------------------
    console.log(
      "1️⃣ [TEST 1] Testing Legitimate Safe Tool Call (echo 'safe_crucible_test')...",
    );
    const s1Res = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Safe Tool Call Session" }),
    });
    const { id: s1Id } = (await s1Res.json()) as { id: string };

    provider.setNextResponse({
      content: "Running safe echo command",
      thought: "Echoing test message",
      toolCalls: [
        {
          id: "call_safe_1",
          name: "bash_exec",
          arguments: { command: "echo 'safe_crucible_test'" },
        },
      ],
    });

    const s1MsgRes = await fetch(`${baseUrl}/sessions/${s1Id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Run safe echo command" }),
    });
    const s1MsgJson = (await s1MsgRes.json()) as {
      status: string;
      response: string;
    };

    if (s1MsgJson.status !== "done") {
      throw new Error(
        `Expected safe tool call to complete with status 'done', got: ${s1MsgJson.status}`,
      );
    }

    const safeExecuted = recordedCommands.includes("echo 'safe_crucible_test'");
    if (!safeExecuted) {
      throw new Error(
        "Expected safe command to execute successfully in executor",
      );
    }
    console.log(
      `   ✓ Safe tool call executed normally and completed with state '${s1MsgJson.status}'.`,
    );
    console.log(`   ✓ Output: "${s1MsgJson.response.trim()}"\n`);

    // -------------------------------------------------------------
    // Test 2: Destructive Tool Call Tripping Policy Gets Paused (Not Silently Run)
    // -------------------------------------------------------------
    console.log(
      "2️⃣ [TEST 2] Testing Destructive Tool Call (rm -rf /tmp/crucible_danger)...",
    );
    const s2Res = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Destructive Tool Call Session" }),
    });
    const { id: s2Id } = (await s2Res.json()) as { id: string };

    provider.setNextResponse({
      content: "I need to delete the directory",
      thought: "Deleting directory",
      toolCalls: [
        {
          id: "call_destructive_1",
          name: "bash_exec",
          arguments: { command: "rm -rf /tmp/crucible_danger" },
        },
      ],
    });

    const s2MsgRes = await fetch(`${baseUrl}/sessions/${s2Id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Delete the target folder" }),
    });
    const s2MsgJson = (await s2MsgRes.json()) as { status: string };

    if (s2MsgJson.status !== "awaiting_human") {
      throw new Error(
        `Expected destructive call to pause at 'awaiting_human', got: ${s2MsgJson.status}`,
      );
    }

    if (actualCommandExecuted) {
      throw new Error(
        "SECURITY BREACH: Destructive command was executed silently before approval!",
      );
    }

    console.log(
      `   ✓ Destructive command was intercepted and paused in state '${s2MsgJson.status}'.`,
    );
    console.log(
      "   ✓ Verified: Destructive command was NOT executed on the host system.\n",
    );

    // -------------------------------------------------------------
    // Test 3: Human Rejection Handles Block Gracefully
    // -------------------------------------------------------------
    console.log(
      "3️⃣ [TEST 3] Submitting Human Rejection via POST /sessions/:id/approval...",
    );
    provider.setNextResponse({
      content: "Understood. I will abort the deletion operation.",
    });

    const rejectRes = await fetch(`${baseUrl}/sessions/${s2Id}/approval`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        approved: false,
        reason: "Deletion of /tmp/crucible_danger is strictly forbidden.",
        toolCallId: "call_destructive_1",
        resume: true,
      }),
    });
    const rejectJson = (await rejectRes.json()) as {
      action: string;
      state: string;
    };

    if (rejectJson.action !== "rejected") {
      throw new Error(`Expected action 'rejected', got: ${rejectJson.action}`);
    }

    // Allow async turn completion
    await new Promise((r) => setTimeout(r, 50));

    if (actualCommandExecuted) {
      throw new Error(
        "SECURITY BREACH: Destructive command ran despite human rejection!",
      );
    }

    console.log(
      `   ✓ Human rejection processed: action = ${rejectJson.action}`,
    );
    console.log(
      "   ✓ Verified: Host system remained untouched throughout rejection.\n",
    );

    console.log(
      "================================================================================",
    );
    console.log(
      "🎉 ALL CONFIRMATION CHECKS PASSED: GUARDRAILS SAFELY ENFORCED!",
    );
    console.log(
      "================================================================================\n",
    );
  } finally {
    server.stop();
  }
}

confirmGuardrailBehavior().catch((err) => {
  console.error("Confirmation test failed:", err);
  process.exit(1);
});
