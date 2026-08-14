import { startHttpServer } from "../http/server";
import { MockModelProvider } from "../provider/mock";
import { ToolRegistry } from "../tools/registry";
import { createBashTool, calculatorTool } from "../tools/builtin";
import { LocalExecutor } from "../execution/local-executor";
import { SessionManager } from "../session/session-manager";
import { GuardrailChain } from "../guardrails/chain";
import { IrreversibleActionPolicy } from "../guardrails/policies/irreversible-action";
import { ResourceBudgetPolicy } from "../guardrails/policies/resource-budget";

async function verifyGuardrailsAndPolicyEngine() {
  console.log(
    "================================================================================",
  );
  console.log("🛡️  CRUCIBLE GUARDRAILS & POLICY ENGINE VERIFICATION");
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
    port: 0,
    hostname: "127.0.0.1",
    sessionManager,
  });

  const baseUrl = `http://127.0.0.1:${server.port}`;

  try {
    console.log(
      "1️⃣ Checking Readiness probe for Guardrails & Policy Engine status...",
    );
    const readyzRes = await fetch(`${baseUrl}/readyz`);
    const readyzJson = (await readyzRes.json()) as {
      status: string;
      checks: Record<string, { status: string; message?: string }>;
    };
    const guardCheck = readyzJson.checks["guardrails_policy_engine"];
    if (!guardCheck || guardCheck.status !== "ok") {
      throw new Error(
        `Guardrails check failed in /readyz: ${JSON.stringify(guardCheck)}`,
      );
    }
    console.log(
      `   ✓ Guardrail Policy Engine status: ${guardCheck.status} (${guardCheck.message})\n`,
    );

    console.log(
      "2️⃣ Creating session and testing Human Checkpoint on destructive action...",
    );
    const createRes = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Guardrail Checkpoint Session" }),
    });
    const { id: sessionId } = (await createRes.json()) as { id: string };

    provider.setNextResponse({
      content: "I need to remove temporary files.",
      thought: "Deleting directory",
      toolCalls: [
        {
          id: "call_del",
          name: "bash_exec",
          arguments: { command: "rm -rf /tmp/test_crucible_trash" },
        },
      ],
    });

    const msgRes = await fetch(`${baseUrl}/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Clean the temp workspace" }),
    });
    const msgJson = (await msgRes.json()) as { status: string };

    if (msgJson.status !== "awaiting_human") {
      throw new Error(
        `Expected session status to be 'awaiting_human', got: ${msgJson.status}`,
      );
    }
    console.log(
      `   ✓ Session paused for human review: status = ${msgJson.status}`,
    );

    console.log(
      "3️⃣ Submitting Human Approval via POST /sessions/:id/approval...",
    );
    provider.setNextResponse({
      content: "Directory cleanup finished.",
    });

    const approveRes = await fetch(
      `${baseUrl}/sessions/${sessionId}/approval`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approved: true,
          toolCallId: "call_del",
          resume: true,
        }),
      },
    );
    const approveJson = (await approveRes.json()) as {
      action: string;
      state: string;
    };
    console.log(
      `   ✓ Approval submitted successfully: action = ${approveJson.action}\n`,
    );

    console.log(
      "4️⃣ Verifying ResourceBudgetPolicy blocks repetitive tool loops...",
    );
    const budgetChain = new GuardrailChain({
      policies: [new ResourceBudgetPolicy({ maxConsecutiveIdenticalCalls: 2 })],
    });

    const loopCall = {
      id: "call_repeat",
      name: "calculator",
      arguments: { expression: "99 * 99" },
    };

    const r1 = await budgetChain.evaluate({
      sessionId: "sess_loop",
      turnId: 1,
      toolCall: loopCall,
    });
    const r2 = await budgetChain.evaluate({
      sessionId: "sess_loop",
      turnId: 2,
      toolCall: loopCall,
    });
    const r3 = await budgetChain.evaluate({
      sessionId: "sess_loop",
      turnId: 3,
      toolCall: loopCall,
    });

    if (
      r1.action !== "allow" ||
      r2.action !== "allow" ||
      r3.action !== "block"
    ) {
      throw new Error(
        `Expected r1=allow, r2=allow, r3=block; got: r1=${r1.action}, r2=${r2.action}, r3=${r3.action}`,
      );
    }
    console.log(
      `   ✓ Infinite tool loop detected and blocked: "${r3.reason}"\n`,
    );

    console.log(
      "5️⃣ Verifying Alert on Policy Engine Exceptions (CRUCIBLE_GUARDRAIL_CHAIN_FAILURE_ALERT)...",
    );

    const { logger } = await import("../observability/logger");
    const originalLoggerError = logger.error.bind(logger);
    const capturedAlerts: string[] = [];

    // Intercept error logging during deliberate simulation
    (logger as any).error = (...args: any[]) => {
      const obj = args[0];
      if (obj && typeof obj === "object" && obj.alert) {
        capturedAlerts.push(obj.alert);
      }
    };

    const faultyChain = new GuardrailChain({
      policies: [
        {
          name: "faulty_policy",
          description: "Throws error",
          evaluate: () => {
            throw new Error("Deliberate policy evaluator crash");
          },
        },
      ],
      failClosedOnPolicyError: true,
    });

    let alertFired = false;
    faultyChain.on("policyError", () => {
      alertFired = true;
    });

    let failResult;
    try {
      failResult = await faultyChain.evaluate({
        sessionId: "sess_alert",
        turnId: 1,
        toolCall: { id: "c1", name: "calculator", arguments: {} },
      });
    } finally {
      (logger as any).error = originalLoggerError;
    }

    if (
      failResult.action !== "block" ||
      !alertFired ||
      !capturedAlerts.includes("CRUCIBLE_GUARDRAIL_CHAIN_FAILURE_ALERT")
    ) {
      throw new Error(
        `Expected failClosed=block, alertFired=true, and CRUCIBLE_GUARDRAIL_CHAIN_FAILURE_ALERT`,
      );
    }

    console.log(
      "   ✓ Policy exception caught and safely failed-closed with CRUCIBLE_GUARDRAIL_CHAIN_FAILURE_ALERT.\n",
    );

    console.log(
      "================================================================================",
    );
    console.log("🎉 ALL GUARDRAILS & POLICY ENGINE CHECKS PASSED!");
    console.log(
      "================================================================================\n",
    );
  } finally {
    server.stop(true);
  }
}

verifyGuardrailsAndPolicyEngine()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Guardrails verification failed:", err);
    process.exit(1);
  });
