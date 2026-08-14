import { describe, expect, it } from "bun:test";
import { LocalExecutor } from "./local-executor";
import {
  DockerExecutor,
  DockerImageFactory,
  DockerContainerConfigBuilder,
  GrpcExecutor,
} from "./";
import { createBashTool } from "../tools/builtin/bash";
import { getErrorReporter } from "../observability/error-reporter";

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

describe("DockerImageFactory (Factory Pattern)", () => {
  it("should resolve language and tool names to minimal sandbox images", () => {
    const factory = new DockerImageFactory();

    expect(factory.resolveImage("node")).toBe("crucible-sandbox-node:latest");
    expect(factory.resolveImage("typescript")).toBe(
      "crucible-sandbox-node:latest",
    );
    expect(factory.resolveImage("python")).toBe(
      "crucible-sandbox-python:latest",
    );
    expect(factory.resolveImage("rust")).toBe("crucible-sandbox-rust:latest");
    expect(factory.resolveImage("bash")).toBe("crucible-sandbox-node:latest");
    expect(factory.resolveImage(undefined, "calculator")).toBe(
      "crucible-sandbox-node:latest",
    );
  });

  it("should prioritize explicit image overrides", () => {
    const factory = new DockerImageFactory();
    const explicit = factory.resolveImage(
      "python",
      undefined,
      "custom-python:3.12",
    );
    expect(explicit).toBe("custom-python:3.12");
  });

  it("should allow registering custom image mappings", () => {
    const factory = new DockerImageFactory({
      go: "crucible-sandbox-go:latest",
    });
    expect(factory.resolveImage("go")).toBe("crucible-sandbox-go:latest");

    factory.registerMapping("ruby", "crucible-sandbox-ruby:latest");
    expect(factory.resolveImage("ruby")).toBe("crucible-sandbox-ruby:latest");
  });
});

describe("DockerContainerConfigBuilder (Builder Pattern)", () => {
  it("should construct valid Docker container creation options with security hardening", () => {
    const builder = new DockerContainerConfigBuilder()
      .withImage("crucible-sandbox-python:latest")
      .withCommand("python3 -c 'print(42)'")
      .withWorkingDir("/workspace/app")
      .withUser("10001:10001")
      .withMemoryLimit(256 * 1024 * 1024)
      .withCpuLimit(500_000_000)
      .withNetworkMode("none")
      .withEnv({ APP_ENV: "sandbox" })
      .withLabels({ "crucible.session": "sess_builder_1" });

    const config = builder.build();

    expect(config.Image).toBe("crucible-sandbox-python:latest");
    expect(config.Cmd).toEqual(["/bin/sh", "-c", "python3 -c 'print(42)'"]);
    expect(config.WorkingDir).toBe("/workspace/app");
    expect(config.User).toBe("10001:10001");
    expect(config.Env).toContain("APP_ENV=sandbox");
    expect(config.HostConfig?.Memory).toBe(256 * 1024 * 1024);
    expect(config.HostConfig?.NanoCpus).toBe(500_000_000);
    expect(config.HostConfig?.NetworkMode).toBe("none");
    expect(config.HostConfig?.CapDrop).toEqual(["ALL"]);
    expect(config.HostConfig?.SecurityOpt).toContain("no-new-privileges:true");
    expect(config.Labels?.["crucible.session"]).toBe("sess_builder_1");
  });

  it("should throw if image is missing during build", () => {
    const builder = new DockerContainerConfigBuilder();
    expect(() => builder.build()).toThrow("Image is required");
  });
});

describe("DockerExecutor (Docker Tool Execution & Telemetry)", () => {
  it("should report availability false when Docker daemon is not connected", async () => {
    const unreachableExecutor = new DockerExecutor({
      socketPath: "/tmp/non_existent_docker_socket.sock",
    });

    const available = await unreachableExecutor.isAvailable();
    expect(available).toBe(false);
  });

  it("should seamlessly fallback to secondary executor when Docker daemon is unavailable", async () => {
    const localExecutor = new LocalExecutor();
    const fallbackDockerExecutor = new DockerExecutor({
      socketPath: "/tmp/non_existent_docker_socket.sock",
      fallbackExecutor: localExecutor,
    });

    const result = await fallbackDockerExecutor.execute({
      command: "echo 'fallback execution success'",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("fallback execution success");
  });

  it("should capture container failures and record distinct error events", async () => {
    const reporter = getErrorReporter();
    reporter.resetMetrics();

    let capturedContainerEvent = false;
    reporter.once("containerFailure", (record) => {
      capturedContainerEvent = true;
      expect(record.containerContext?.reason).toBe("CONTAINER_OOM_KILLED");
      expect(record.containerContext?.oomKilled).toBe(true);
    });

    reporter.captureContainerFailure({
      containerId: "cnt_abc12345",
      image: "crucible-sandbox-python:latest",
      exitCode: 137,
      oomKilled: true,
      memoryLimitBytes: 128 * 1024 * 1024,
      reason: "CONTAINER_OOM_KILLED",
      sessionId: "sess_oom_test",
      toolName: "bash_exec",
    });

    expect(capturedContainerEvent).toBe(true);
    const metrics = reporter.getMetrics();
    expect(metrics.totalErrors).toBe(1);
    expect(metrics.containerFailuresCount).toBe(1);
  });
});

describe("GrpcExecutor (Rust gRPC IPC & Telemetry)", () => {
  it("should have correct executor identity", () => {
    const grpcExec = new GrpcExecutor({ address: "127.0.0.1:59999" });
    expect(grpcExec.name).toBe("rust_grpc");
    grpcExec.close();
  });

  it("should report availability false when gRPC server is unreachable", async () => {
    const unreachableGrpc = new GrpcExecutor({
      address: "127.0.0.1:59998",
    });

    const available = await unreachableGrpc.isAvailable();
    expect(available).toBe(false);
    unreachableGrpc.close();
  });

  it("should fallback to secondary executor when gRPC server is unavailable", async () => {
    const local = new LocalExecutor();
    const fallbackGrpc = new GrpcExecutor({
      address: "127.0.0.1:59997",
      fallbackExecutor: local,
    });

    const result = await fallbackGrpc.execute({
      command: "echo 'grpc fallback success'",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("grpc fallback success");
    fallbackGrpc.close();
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
