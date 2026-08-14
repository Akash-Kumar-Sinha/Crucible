import { describe, expect, it } from "bun:test";
import { LocalExecutor } from "./local-executor";
import { createBashTool } from "../tools/builtin/bash";

describe("LocalExecutor (Adapter Pattern)", () => {
  const executor = new LocalExecutor();

  it("should execute a simple command and capture stdout", async () => {
    const res = await executor.execute({
      command: "echo 'crucible harness online'",
    });

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("crucible harness online");
    expect(res.stderr).toBe("");
    expect(typeof res.durationMs).toBe("number");
  });

  it("should capture non-zero exit codes and stderr on command failure", async () => {
    const res = await executor.execute({
      command: "ls /invalid_directory_path_12345",
    });

    expect(res.exitCode).not.toBe(0);
    expect(res.stderr.length).toBeGreaterThan(0);
  });

  it("should respect custom working directory", async () => {
    const res = await executor.execute({
      command: "pwd",
      cwd: "/tmp",
    });

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("/tmp");
  });

  it("should pass custom environment variables", async () => {
    const res = await executor.execute({
      command: "echo $TEST_VAR_CRUCIBLE",
      env: { TEST_VAR_CRUCIBLE: "env_variable_success" },
    });

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("env_variable_success");
  });

  it("should terminate processes exceeding execution timeout", async () => {
    const res = await executor.execute({
      command: "sleep 2",
      timeoutMs: 50,
    });

    expect(res.killed).toBe(true);
  });

  it("should terminate process when AbortSignal fires", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const res = await executor.execute({
      command: "sleep 2",
      signal: controller.signal,
    });

    expect(res.killed).toBe(true);
  });
});

describe("Bash Tool Integration with Executor", () => {
  it("should execute commands through bashTool definition", async () => {
    const bashTool = createBashTool();

    const result = await bashTool.execute(
      { command: "echo 100 + 200" },
      { sessionId: "sess_exec_test", step: 1 },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("100 + 200");
  });
});
