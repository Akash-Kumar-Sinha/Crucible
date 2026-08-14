import { describe, expect, test } from "bun:test";
import { GuardrailChain } from "./chain";
import { IrreversibleActionPolicy } from "./policies/irreversible-action";
import { ResourceBudgetPolicy } from "./policies/resource-budget";
import { ToolRegistry } from "../tools/registry";
import { createBashTool, calculatorTool } from "../tools/builtin";
import { LocalExecutor } from "../execution/local-executor";
import { SessionManager } from "../session/session-manager";
import { MockModelProvider } from "../provider/mock";
import type { ToolCall } from "../schema/envelope";

describe("Guardrails & Policy Engine", () => {
  describe("IrreversibleActionPolicy", () => {
    test("should allow benign commands", () => {
      const policy = new IrreversibleActionPolicy();
      const toolCall: ToolCall = {
        id: "call_1",
        name: "bash",
        arguments: { command: "ls -la /workspace" },
      };

      const result = policy.evaluate({
        sessionId: "sess_1",
        turnId: 1,
        toolCall,
      });

      expect(result.action).toBe("allow");
    });

    test("should require approval for dangerous destructive commands", () => {
      const policy = new IrreversibleActionPolicy({ mode: "require_approval" });
      const dangerousCalls: string[] = [
        "rm -rf /tmp/data",
        "mkfs.ext4 /dev/sdb",
        "dd if=/dev/zero of=/dev/sda",
        "shutdown -h now",
        "DROP DATABASE production;",
        "chmod -R 777 /etc",
      ];

      for (const cmd of dangerousCalls) {
        const result = policy.evaluate({
          sessionId: "sess_1",
          turnId: 1,
          toolCall: { id: "call_x", name: "bash", arguments: { command: cmd } },
        });

        expect(result.action).toBe("require_approval");
        expect(result.policyName).toBe("irreversible_action");
      }
    });

    test("should block destructive commands when configured in strict block mode", () => {
      const policy = new IrreversibleActionPolicy({ mode: "block" });
      const result = policy.evaluate({
        sessionId: "sess_1",
        turnId: 1,
        toolCall: {
          id: "call_rm",
          name: "bash",
          arguments: { command: "rm -rf /" },
        },
      });

      expect(result.action).toBe("block");
      expect(result.policyName).toBe("irreversible_action");
    });
  });

  describe("ResourceBudgetPolicy", () => {
    test("should enforce per-turn limits", () => {
      const policy = new ResourceBudgetPolicy({ maxCallsPerTurn: 2 });
      const toolCall: ToolCall = {
        id: "call_1",
        name: "calculator",
        arguments: { expression: "2+2" },
      };

      const res1 = policy.evaluate({
        sessionId: "sess_1",
        turnId: 1,
        toolCall,
      });
      expect(res1.action).toBe("allow");

      const res2 = policy.evaluate({
        sessionId: "sess_1",
        turnId: 1,
        toolCall,
      });
      expect(res2.action).toBe("allow");

      const res3 = policy.evaluate({
        sessionId: "sess_1",
        turnId: 1,
        toolCall,
      });
      expect(res3.action).toBe("block");
      expect(res3.reason).toContain("Turn tool call limit exceeded");
    });

    test("should detect and block infinite identical tool call loops", () => {
      const policy = new ResourceBudgetPolicy({
        maxConsecutiveIdenticalCalls: 3,
      });
      const toolCall: ToolCall = {
        id: "call_loop",
        name: "calculator",
        arguments: { expression: "10 * 10" },
      };

      expect(
        policy.evaluate({ sessionId: "sess_loop", turnId: 1, toolCall }).action,
      ).toBe("allow");
      expect(
        policy.evaluate({ sessionId: "sess_loop", turnId: 2, toolCall }).action,
      ).toBe("allow");
      expect(
        policy.evaluate({ sessionId: "sess_loop", turnId: 3, toolCall }).action,
      ).toBe("allow");

      const blocked = policy.evaluate({
        sessionId: "sess_loop",
        turnId: 4,
        toolCall,
      });
      expect(blocked.action).toBe("block");
      expect(blocked.reason).toContain("Detected infinite tool loop");
    });
  });

  describe("GuardrailChain (Chain of Responsibility)", () => {
    test("should catch and alert on policy exceptions and fail closed", async () => {
      const faultyPolicy = {
        name: "buggy_policy",
        description: "Throws intentionally to verify guardrail error alerting",
        evaluate: () => {
          throw new Error("Simulated syntax error in policy engine");
        },
      };

      const chain = new GuardrailChain({
        policies: [faultyPolicy],
        failClosedOnPolicyError: true,
      });

      let policyErrorEmitted = false;
      chain.on("policyError", () => {
        policyErrorEmitted = true;
      });

      const result = await chain.evaluate({
        sessionId: "sess_err",
        turnId: 1,
        toolCall: { id: "call_1", name: "calculator", arguments: {} },
      });

      expect(result.action).toBe("block");
      expect(result.reason).toContain(
        "Guardrail policy check failed due to an internal error",
      );
      expect(policyErrorEmitted).toBe(true);
    });

    test("should track repeated blocks and emit alert when threshold is crossed", async () => {
      const blockingPolicy = {
        name: "always_block",
        description: "Always blocks to test repeated block alerting",
        evaluate: () => ({
          action: "block" as const,
          policyName: "always_block",
          reason: "Blocked",
        }),
      };

      const chain = new GuardrailChain({
        policies: [blockingPolicy],
        repeatedBlockThreshold: 3,
      });

      let thresholdExceeded = false;
      chain.on("repeatedBlocksThresholdExceeded", (ev) => {
        if (ev.sessionId === "sess_repeat" && ev.blockCount >= 3) {
          thresholdExceeded = true;
        }
      });

      await chain.evaluate({
        sessionId: "sess_repeat",
        turnId: 1,
        toolCall: { id: "c1", name: "bash", arguments: {} },
      });
      await chain.evaluate({
        sessionId: "sess_repeat",
        turnId: 2,
        toolCall: { id: "c2", name: "bash", arguments: {} },
      });
      await chain.evaluate({
        sessionId: "sess_repeat",
        turnId: 3,
        toolCall: { id: "c3", name: "bash", arguments: {} },
      });

      expect(thresholdExceeded).toBe(true);
      expect(chain.getBlockHistory("sess_repeat").length).toBe(3);
    });
  });

  describe("End-to-End Session Pause for Human Review & Human Approval", () => {
    test("should pause for human approval on dangerous command and resume upon approval", async () => {
      const executor = new LocalExecutor();
      const tools = new ToolRegistry()
        .register(calculatorTool)
        .register(createBashTool({ executor }));

      const guardrails = new GuardrailChain({
        policies: [new IrreversibleActionPolicy({ mode: "require_approval" })],
      });

      const provider = new MockModelProvider();
      // Mock dangerous tool call
      provider.setNextResponse({
        content: "I will clean up the directory",
        thought: "Deleting temp files",
        toolCalls: [
          {
            id: "call_rm",
            name: "bash",
            arguments: { command: "rm -rf /tmp/test_dir" },
          },
        ],
      });

      const manager = new SessionManager({
        defaultProvider: provider,
        defaultTools: tools,
        defaultGuardrails: guardrails,
      });

      const session = manager.createSession({
        sessionId: "sess_human_checkpoint",
      });

      let approvalRequiredEmitted = false;
      session.on("humanApprovalRequired", () => {
        approvalRequiredEmitted = true;
      });

      const promptPromise = session.prompt("Clean the workspace");
      const result = await promptPromise;

      expect(result.state).toBe("awaiting_human");
      expect(session.getStatus()).toBe("awaiting_human");
      expect(approvalRequiredEmitted).toBe(true);

      // Submit human approval
      session.approve("call_rm");

      // Set model's final response upon resuming
      provider.setNextResponse({
        content: "Cleanup completed successfully.",
      });

      const resumedResult = await session.resume();
      expect(resumedResult.state).toBe("done");
      expect(session.getStatus()).toBe("done");
    });

    test("should feed rejection observation back to agent when human rejects tool call", async () => {
      const executor = new LocalExecutor();
      const tools = new ToolRegistry()
        .register(calculatorTool)
        .register(createBashTool({ executor }));

      const guardrails = new GuardrailChain({
        policies: [new IrreversibleActionPolicy({ mode: "require_approval" })],
      });

      const provider = new MockModelProvider();
      provider.setNextResponse({
        content: "Dropping table",
        thought: "About to drop database",
        toolCalls: [
          {
            id: "call_drop",
            name: "bash",
            arguments: { command: "DROP TABLE users;" },
          },
        ],
      });

      const manager = new SessionManager({
        defaultProvider: provider,
        defaultTools: tools,
        defaultGuardrails: guardrails,
      });

      const session = manager.createSession({
        sessionId: "sess_human_reject",
      });

      const result = await session.prompt("Drop the users table");
      expect(result.state).toBe("awaiting_human");

      // Human rejects
      session.reject(
        "Dropping tables is forbidden in this environment.",
        "call_drop",
      );

      provider.setNextResponse({
        content: "Understood, I will not drop the table.",
      });

      const resumed = await session.resume();
      expect(resumed.state).toBe("done");
      const messages = session.getMessages();
      const toolMsg = messages.find((m) => m.role === "tool");
      expect(toolMsg).toBeDefined();
      expect(toolMsg?.content).toContain("rejected");
    });
  });
});
