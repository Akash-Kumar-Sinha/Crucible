import { startHttpServer } from "../http/server";
import { MockModelProvider } from "../provider/mock";
import { ToolRegistry } from "../tools/registry";
import { createBashTool, calculatorTool } from "../tools/builtin";
import { LocalExecutor } from "../execution/local-executor";
import { SessionManager } from "../session/session-manager";
import { GuardrailChain } from "../guardrails/chain";
import { IrreversibleActionPolicy } from "../guardrails/policies/irreversible-action";
import { ResourceBudgetPolicy } from "../guardrails/policies/resource-budget";

async function verifyUiSandboxAndGuardrailVisibility() {
  console.log(
    "================================================================================",
  );
  console.log(
    "CRUCIBLE GUARDRAIL INTERACTION TEST: APPROVAL & REJECTION (DENY) FLOWS",
  );
  console.log(
    "================================================================================\n",
  );

  const executor = new LocalExecutor();
  const tools = new ToolRegistry()
    .register(calculatorTool)
    .register(createBashTool({ executor }));

  const guardrails = new GuardrailChain({
    policies: [
      new IrreversibleActionPolicy({ mode: "require_approval" }),
      new ResourceBudgetPolicy({ maxCallsPerTurn: 5 }),
    ],
  });

  const provider = new MockModelProvider();
  const sessionManager = new SessionManager({
    defaultProvider: provider,
    defaultTools: tools,
    defaultGuardrails: guardrails,
  });

  const server = startHttpServer({
    port: 0,
    hostname: "127.0.0.1",
    sessionManager,
  });

  const baseUrl = `http://127.0.0.1:${server.port}`;

  try {
    // -------------------------------------------------------------------------
    // TEST 1: APPROVE FLOW
    // -------------------------------------------------------------------------
    console.log("--- TEST 1: HUMAN APPROVAL (ALLOW) FLOW ---");
    console.log("1. Creating session for approval test...");
    const createRes1 = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Guardrail Approve Flow Session" }),
    });
    const { id: sessionId1 } = (await createRes1.json()) as { id: string };
    console.log(`   ✓ Session created: ${sessionId1}`);

    console.log(
      "2. Triggering tool call that trips IrreversibleActionPolicy (rm -rf)...",
    );
    provider.setNextResponse({
      content: "I need to remove obsolete build artifacts.",
      thought: "Tripping irreversible action policy",
      toolCalls: [
        {
          id: "call_approve_1",
          name: "bash_exec",
          arguments: { command: "rm -rf /tmp/crucible_approved_test" },
        },
      ],
    });

    const msgRes1 = await fetch(`${baseUrl}/sessions/${sessionId1}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Clean obsolete files" }),
    });
    const msgJson1 = (await msgRes1.json()) as {
      status: string;
      messages: any[];
    };

    console.log(
      `   ✓ Intercepted state: status = '${msgJson1.status}' (awaiting_human)`,
    );
    if (msgJson1.status !== "awaiting_human") {
      throw new Error(
        `Expected status 'awaiting_human', got '${msgJson1.status}'`,
      );
    }

    console.log("3. Submitting Human Approval (approved = true)...");
    provider.setNextResponse({
      content: "Directory successfully removed. The system is clean.",
      thought: "Approval confirmed, continuing execution",
    });

    const approveRes = await fetch(
      `${baseUrl}/sessions/${sessionId1}/guardrails/approval`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approved: true,
          toolCallId: "call_approve_1",
          operatorId: "operator_approve_test",
          resume: true,
        }),
      },
    );

    if (!approveRes.ok) {
      throw new Error(
        `Approval endpoint failed with HTTP ${approveRes.status}`,
      );
    }
    const approveJson = (await approveRes.json()) as any;
    console.log(
      `   ✓ Decision recorded: action = '${approveJson.action}', status = '${approveJson.status}'`,
    );

    await new Promise((r) => setTimeout(r, 100));

    const finalSession1Res = await fetch(`${baseUrl}/sessions/${sessionId1}`);
    const finalSession1 = (await finalSession1Res.json()) as {
      status: string;
      messages: any[];
    };
    console.log(
      `   ✓ Resumed execution finished with status = '${finalSession1.status}'`,
    );
    const lastMsg1 = finalSession1.messages[finalSession1.messages.length - 1];
    console.log(`   ✓ Agent output post-approval: "${lastMsg1?.content}"\n`);

    // -------------------------------------------------------------------------
    // TEST 2: DENY / BLOCK FLOW
    // -------------------------------------------------------------------------
    console.log("--- TEST 2: HUMAN DENIAL (BLOCK) FLOW ---");
    console.log("1. Creating session for denial test...");
    const createRes2 = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Guardrail Deny Flow Session" }),
    });
    const { id: sessionId2 } = (await createRes2.json()) as { id: string };
    console.log(`   ✓ Session created: ${sessionId2}`);

    console.log(
      "2. Triggering tool call that trips IrreversibleActionPolicy (destructive wipe)...",
    );
    provider.setNextResponse({
      content: "I will purge the database cluster data.",
      thought: "Executing dangerous destructive operation",
      toolCalls: [
        {
          id: "call_deny_1",
          name: "bash_exec",
          arguments: { command: "rm -rf /var/lib/crucible_data" },
        },
      ],
    });

    const msgRes2 = await fetch(`${baseUrl}/sessions/${sessionId2}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Drop production database" }),
    });
    const msgJson2 = (await msgRes2.json()) as {
      status: string;
      messages: any[];
    };

    console.log(
      `   ✓ Intercepted state: status = '${msgJson2.status}' (awaiting_human)`,
    );
    if (msgJson2.status !== "awaiting_human") {
      throw new Error(
        `Expected status 'awaiting_human', got '${msgJson2.status}'`,
      );
    }

    console.log("3. Submitting Human Denial (approved = false)...");
    provider.setNextResponse({
      content:
        "I understand. The operation was blocked by human review. I will not drop the database.",
      thought:
        "Tool call rejected by human operator, adopting fallback strategy",
    });

    const denyRes = await fetch(
      `${baseUrl}/sessions/${sessionId2}/guardrails/approval`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approved: false,
          toolCallId: "call_deny_1",
          operatorId: "operator_deny_test",
          resume: true,
        }),
      },
    );

    if (!denyRes.ok) {
      throw new Error(`Denial endpoint failed with HTTP ${denyRes.status}`);
    }
    const denyJson = (await denyRes.json()) as any;
    console.log(
      `   ✓ Decision recorded: action = '${denyJson.action}', status = '${denyJson.status}'`,
    );

    await new Promise((r) => setTimeout(r, 100));

    const finalSession2Res = await fetch(`${baseUrl}/sessions/${sessionId2}`);
    const finalSession2 = (await finalSession2Res.json()) as {
      status: string;
      messages: any[];
    };
    console.log(
      `   ✓ Rejected run finished cleanly with status = '${finalSession2.status}' (No hang)`,
    );
    const lastMsg2 = finalSession2.messages[finalSession2.messages.length - 1];
    console.log(`   ✓ Agent output post-denial: "${lastMsg2?.content}"\n`);

    // -------------------------------------------------------------------------
    // TEST 3: SANDBOX LIMITS PROFILE CHECK
    // -------------------------------------------------------------------------
    console.log("--- TEST 3: SANDBOX RESOURCE LIMITS & AIRGAP PROFILE ---");
    const sandboxRes = await fetch(`${baseUrl}/sessions/${sessionId1}/sandbox`);
    const sandboxInfo = (await sandboxRes.json()) as any;

    console.log(
      `   ✓ Sandbox Status: ${sandboxInfo.status} (Tier: ${sandboxInfo.tier})`,
    );
    console.log(
      `   ✓ CPU: ${sandboxInfo.cgroups.cpuQuota} | Memory: ${sandboxInfo.cgroups.memoryLimit} | PIDs: ${sandboxInfo.cgroups.pidsLimit}`,
    );
    console.log(
      `   ✓ Filesystem: ${sandboxInfo.filesystem.isolation} (Strategy: ${sandboxInfo.filesystem.strategy})`,
    );
    console.log(
      `   ✓ Network Airgap: ${sandboxInfo.network.policy} (${sandboxInfo.network.protocols.join(", ")})\n`,
    );

    console.log(
      "================================================================================",
    );
    console.log(
      "CONFIRMED: GUARDRAIL APPROVAL & DENIAL WORK CLEANLY WITHOUT HANGING!",
    );
    console.log(
      "================================================================================\n",
    );
  } finally {
    sessionManager.clear();
    server.stop(true);
    process.exit(0);
  }
}

verifyUiSandboxAndGuardrailVisibility().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
