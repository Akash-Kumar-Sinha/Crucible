import { describe, it, expect } from "bun:test";
import { getRoleRegistry } from "./role-registry";
import { coderRole } from "./roles/coder";
import { ToolRegistry } from "../tools/registry";
import { readFileTool, writeFileTool, calculatorTool } from "../tools/builtin";
import { Session } from "../session/session";
import { MockModelProvider } from "../provider/mock";

describe("Agent Roles & Prompt Templates", () => {
  const registry = getRoleRegistry();

  it("should have all 4 specialized roles + general registered", () => {
    const roles = registry.listRoles();
    const roleIds = roles.map((r) => r.id);

    expect(roleIds).toContain("coder");
    expect(roleIds).toContain("test_writer");
    expect(roleIds).toContain("bug_hunter");
    expect(roleIds).toContain("bug_fixer");
    expect(roleIds).toContain("general");
  });

  it("should enforce read-only tool restrictions for bug_hunter role", () => {
    const bugHunter = registry.getRole("bug_hunter");
    expect(bugHunter.readOnly).toBe(true);
    expect(bugHunter.allowedTools).toContain("read_file");
    expect(bugHunter.allowedTools).toContain("bash_exec");
    expect(bugHunter.allowedTools).not.toContain("write_file");

    const baseTools = new ToolRegistry();
    baseTools.register(readFileTool);
    baseTools.register(writeFileTool);
    baseTools.register(calculatorTool);

    const filteredTools = registry.createRoleFilteredToolRegistry(
      bugHunter,
      baseTools,
    );
    const definitions = filteredTools.getDefinitions();

    expect(definitions.some((d) => d.name === "read_file")).toBe(true);
    expect(definitions.some((d) => d.name === "calculator")).toBe(true);
    expect(definitions.some((d) => d.name === "write_file")).toBe(false);
  });

  it("should block write_file tool calls via guardrail chain for bug_hunter role", async () => {
    const bugHunter = registry.getRole("bug_hunter");
    const guardrailChain = registry.createRoleGuardrailChain(bugHunter);

    const blockedResult = await guardrailChain.evaluate({
      sessionId: "sess_hunter_test",
      turnId: 1,
      toolCall: {
        id: "call_write_1",
        name: "write_file",
        arguments: { path: "src/exploit.ts", content: "payload" },
      },
    });

    expect(blockedResult.action).toBe("block");
    expect(blockedResult.reason).toContain("read-only");

    const allowedResult = await guardrailChain.evaluate({
      sessionId: "sess_hunter_test",
      turnId: 1,
      toolCall: {
        id: "call_read_1",
        name: "read_file",
        arguments: { path: "src/index.ts" },
      },
    });

    expect(allowedResult.action).toBe("allow");
  });

  it("should bootstrap session with role system prompt, model and metadata (Template Method)", () => {
    const coderSessionConfig = registry.bootstrapSessionConfig({
      sessionId: "sess_coder_1",
      role: "coder",
    });

    expect(coderSessionConfig.model).toBe(coderRole.defaultModel);
    expect(coderSessionConfig.systemPrompt).toBe(coderRole.systemPrompt);
    expect(coderSessionConfig.metadata?.role).toBe("coder");
    expect(coderSessionConfig.metadata?.readOnly).toBe(false);
  });

  it("should initialize Session actor with assigned role and tag metadata", () => {
    const mockProvider = new MockModelProvider();
    const session = new Session({
      sessionId: "sess_role_actor",
      role: "bug_hunter",
      provider: mockProvider,
    });

    expect(session.getRole()).toBe("bug_hunter");
    const summary = session.getSummary();
    expect(summary.role).toBe("bug_hunter");
    expect(summary.metadata.role).toBe("bug_hunter");
    expect(summary.metadata.readOnly).toBe(true);
  });
});
